"""Opt-in integration test. Uses a unique test database; never writes production content."""

import asyncio
import os
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pymongo import AsyncMongoClient

from app.config import settings
from app.documents import DocumentStorage
from app.models import InternalRequest
from app.rag import RagService, now

pytestmark = pytest.mark.skipif(
    os.getenv("AI_TEST_LIVE_MONGO") != "1", reason="Requires explicit live Mongo opt-in"
)


class FakeProvider:
    calls = 0

    def require_configured(self):
        pass

    async def embed(self, texts):
        return [[1.0] + [0.0] * 1535 for _ in texts]

    async def answer(self, _question, _sources, _history):
        self.calls += 1
        await asyncio.sleep(0.05)
        return {
            "sourceQuotes": [{"sourceId": "S1", "quote": "Stack dùng LIFO."}],
            "supplementalAnswer": "Ví dụ minh họa: xếp chồng đĩa.",
            "insufficientEvidence": False,
        }


async def test_mongo_queue_persistence_isolation_replay_and_recovery():
    client = AsyncMongoClient(settings.mongo_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    test_database_name = "codementor_ai_test_" + uuid4().hex
    db = client[test_database_name]
    provider = FakeProvider()
    rag = RagService(db, settings, provider, DocumentStorage(settings))
    user_id, workspace_id, document_id = str(uuid4()), str(uuid4()), str(uuid4())
    source = {
        "id": document_id,
        "title": "Stack",
        "docType": "txt",
        "storageKey": None,
        "previewText": "Stack dùng LIFO.",
        "revision": "a" * 64,
    }
    body = {"userId": user_id, "workspaceId": workspace_id, "sources": [source]}
    req = InternalRequest(**body)
    try:
        # Copy only schemas/indexes to verify the actual production validators, not permissive mocks.
        for name in ("ai_document_indexes", "ai_conversations", "ai_usage"):
            info = (
                await (await client[settings.mongo_db].list_collections(filter={"name": name})).to_list(1)
            )
            assert info, "Run npm run migrate:ai first"
            await db.create_collection(name, validator=info[0]["options"]["validator"])
        assert (await rag.queue_index(req))["state"] == "queued"
        await rag.process_next()
        assert (await rag.states(req))[0]["state"] == "ready"
        created = await rag.create(req)
        turn_request = InternalRequest(
            **body, id=created["id"], question="Stack hoạt động thế nào?", requestId=uuid4()
        )
        turn = await rag.ask(turn_request)
        assert turn["citations"][0]["documentId"] == document_id
        assert await rag.ask(turn_request) == turn
        assert provider.calls == 1
        # New service object reads persisted data; no process-local history.
        restarted = RagService(db, settings, provider, DocumentStorage(settings))
        loaded = await restarted.read(InternalRequest(**body, id=created["id"]))
        assert len(loaded["turns"]) == 1
        assert loaded["turns"][0]["answer"] == "> Stack dùng LIFO. [S1]"
        assert loaded["turns"][0]["supplementalAnswer"] == "Ví dụ minh họa: xếp chồng đĩa."
        for scope_change in ({"userId": str(uuid4())}, {"workspaceId": str(uuid4())}):
            with pytest.raises(HTTPException) as error:
                await rag.read(InternalRequest(**{**body, **scope_change}, id=created["id"]))
            assert error.value.status_code == 404
        with pytest.raises(HTTPException):
            await rag.read(
                InternalRequest(
                    **{**body, "sources": [{**source, "revision": "b" * 64}]}, id=created["id"]
                )
            )
        second = InternalRequest(
            **body, id=created["id"], question="Giải thích LIFO", requestId=uuid4()
        )
        results = await asyncio.gather(rag.ask(second), rag.ask(second), return_exceptions=True)
        assert any(isinstance(result, dict) for result in results)
        assert any(
            isinstance(result, HTTPException) and result.status_code == 409 for result in results
        )
        for _ in range(2):
            await rag.create(req)
        history = await rag.list(
            InternalRequest(userId=user_id, workspaceId=workspace_id, page=2, limit=2)
        )
        assert history["total"] == 3 and len(history["items"]) == 1
        # Interrupted indexing can be picked up after its lease expires.
        await db["ai_document_indexes"].update_one(
            {"documentId": document_id},
            {"$set": {"state": "processing", "leaseUntil": now() - timedelta(minutes=1)}},
        )
        await restarted.process_next()
        assert (await restarted.states(req))[0]["state"] == "ready"
        await rag.delete(InternalRequest(**body, id=created["id"]))
        assert await db["ai_conversations"].count_documents({"_id": created["id"]}) == 0
    finally:
        # Exact database created above; the configured application database is never deleted.
        assert test_database_name.startswith("codementor_ai_test_")
        assert test_database_name != settings.mongo_db
        await client.drop_database(test_database_name)
        await client.close()
