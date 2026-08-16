FROM gcc:13-bookworm
RUN useradd -m -u 1000 runner
USER runner
WORKDIR /home/runner
