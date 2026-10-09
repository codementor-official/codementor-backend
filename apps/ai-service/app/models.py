from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(StrictModel):
    id: UUID
    title: str = Field(max_length=500)
    docType: str = Field(max_length=30)
    storageKey: str | None = Field(default=None, max_length=2000)
    previewText: str | None = Field(default=None, max_length=1_000_000)
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")


class InternalRequest(StrictModel):
    userId: UUID
    workspaceId: UUID
    sources: list[Source] = Field(default_factory=list, max_length=30)

    @field_validator("sources")
    @classmethod
    def distinct_sources(cls, value: list[Source]) -> list[Source]:
        if len({item.id for item in value}) != len(value):
            raise ValueError("Duplicate sources")
        return value

    @property
    def scope(self) -> dict[str, str]:
        return {"userId": str(self.userId), "workspaceId": str(self.workspaceId)}

    @property
    def source_dicts(self) -> list[dict]:
        return [source.model_dump(mode="json") for source in self.sources]
