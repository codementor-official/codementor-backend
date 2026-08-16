FROM php:8.3-cli-bookworm
RUN useradd -m -u 1000 runner
USER runner
WORKDIR /home/runner
