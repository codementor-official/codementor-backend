FROM gcc:13-bookworm

# Image này phục vụ CẢ C lẫn C++ (xem execution_config.py), và chế độ chấm theo chữ ký hàm
# cần đọc/ghi JSON ở cả hai. Container lúc chạy không có mạng nên thư viện phải nằm sẵn đây.
#
# C++ dùng nlohmann/json: một header duy nhất, tải thẳng vào include path.
# C dùng cJSON: có trong kho Debian, khỏi phải vendor mã nguồn vào repo.
ARG NLOHMANN_VERSION=v3.11.3
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcjson-dev \
    && mkdir -p /usr/local/include/nlohmann \
    && curl -fsSL -o /usr/local/include/nlohmann/json.hpp \
       "https://raw.githubusercontent.com/nlohmann/json/${NLOHMANN_VERSION}/single_include/nlohmann/json.hpp" \
    && rm -rf /var/lib/apt/lists/*

# Precompiled header cho nlohmann. Không có nó, mỗi bài C++ phải dịch lại ~25 nghìn dòng
# header: 8–15s một lần khi máy rảnh, và vượt cả trần 30s khi nhiều container chạy song song.
# Cờ phải TRÙNG với cờ lúc chấm (`g++ -O2 -std=c++17`), nếu không gcc lặng lẽ bỏ qua .gch và
# ta mất tác dụng mà không có cảnh báo nào.
RUN printf '#include <nlohmann/json.hpp>\n' > /usr/local/include/codementor_pch.hpp \
    && g++ -O2 -std=c++17 -x c++-header /usr/local/include/codementor_pch.hpp \
       -o /usr/local/include/codementor_pch.hpp.gch

RUN useradd -m -u 1000 runner
USER runner
WORKDIR /home/runner
