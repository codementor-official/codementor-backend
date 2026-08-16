FROM eclipse-temurin:17-jdk

# Java không có JSON trong thư viện chuẩn. Chế độ chấm theo chữ ký hàm cần đọc tham số và ghi
# kết quả dưới dạng JSON, nên Gson đi cùng image — thay cho việc tự viết bộ parse JSON trong
# driver sinh ra. Container lúc chạy không có mạng; jar phải nằm sẵn ở đây.
# Phiên bản ghim: đổi nó là đổi thứ mọi bài Java được biên dịch cùng.
ARG GSON_VERSION=2.11.0
ARG GSON_URL=https://repo1.maven.org/maven2/com/google/code/gson/gson/${GSON_VERSION}/gson-${GSON_VERSION}.jar
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && curl -fsSL -o /opt/gson.jar "${GSON_URL}" \
    && apt-get purge -y curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/runner && chown 1000:1000 /home/runner
USER 1000:1000
WORKDIR /home/runner
