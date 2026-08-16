FROM golang:1.22-bookworm
RUN useradd -m -u 1000 runner
# go build wants a writable $GOCACHE (defaults under $HOME); root fs is
# read_only at runtime with only /tmp writable (tmpfs) -- point it there.
ENV GOCACHE=/tmp/go-cache
USER runner
WORKDIR /home/runner
