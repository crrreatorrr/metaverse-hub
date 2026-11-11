FROM node:22-bookworm-slim
# prlimit enforces per-process hard CPU seconds and descriptor limits. The outer
# launch contract supplies cgroup/PID/network constraints (compose.test.yml).
RUN apt-get update && apt-get install -y --no-install-recommends util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/shooter-verifier ./services/shooter-verifier
USER node
# No public listener or production service exists in PR09.
CMD ["node", "--test", "services/shooter-verifier/test/runtime.test.mjs"]
