FROM emscripten/emsdk:3.1.74@sha256:af45409f3199d88db4b1b03af0098532c8fb33a375ac257463eeb0a622870d06

# wabt supplies wasm-objdump; the tarball is hash-checked so the image does not drift with apt.
ARG WABT_VERSION=1.0.36
ARG WABT_SHA256=4aa0929db06c2376cc76f6d9e920dbde2ea6f1fd55bbaed6cd65167e9e39ecd3
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3-pip curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir meson==1.5.2 ninja==1.11.1.1 \
 && curl -fsSL -o /tmp/wabt.tgz "https://github.com/WebAssembly/wabt/releases/download/${WABT_VERSION}/wabt-${WABT_VERSION}-ubuntu-20.04.tar.gz" \
 && echo "${WABT_SHA256}  /tmp/wabt.tgz" | sha256sum -c - \
 && tar -xzf /tmp/wabt.tgz -C /opt \
 && ln -s /opt/wabt-${WABT_VERSION}/bin/wasm-objdump /usr/local/bin/wasm-objdump \
 && rm /tmp/wabt.tgz
