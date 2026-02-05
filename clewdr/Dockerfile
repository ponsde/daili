FROM ubuntu:24.04
WORKDIR /app
COPY clewdr /app/clewdr
RUN sed -i 's@//.*archive.ubuntu.com@//mirrors.aliyun.com@g' /etc/apt/sources.list.d/ubuntu.sources && \
    sed -i 's@//.*security.ubuntu.com@//mirrors.aliyun.com@g' /etc/apt/sources.list.d/ubuntu.sources && \
    apt-get update && apt-get install -y ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    chmod +x /app/clewdr
EXPOSE 8484
CMD ["/app/clewdr"]
