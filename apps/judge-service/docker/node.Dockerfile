FROM node:20-bookworm-slim
# official image already has a uid-1000 "node" user; reuse it (matches the
# java.Dockerfile pattern -- useradd fails here with "UID 1000 is not unique")
#
# @types/node is needed for ANY TS submission that touches stdin/fs/process --
# tsc's default lib has no Node globals at all without it. Submissions run in
# a fresh, throwaway workdir each time (no persistent node_modules), so this
# installs the types once into a fixed location and points --typeRoots there
# (see execution_config.py's "typescript" compile_cmd) instead of expecting
# per-submission npm installs.
RUN npm install -g typescript \
    && mkdir -p /opt/ts-types && cd /opt/ts-types && npm init -y >/dev/null && npm install --save-dev @types/node \
    && mkdir -p /home/runner && chown -R 1000:1000 /home/runner /opt/ts-types
USER 1000:1000
WORKDIR /home/runner
