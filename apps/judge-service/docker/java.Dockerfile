FROM eclipse-temurin:17-jdk
RUN mkdir -p /home/runner && chown 1000:1000 /home/runner
USER 1000:1000
WORKDIR /home/runner
