const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const ASSETS_OFFSET = 0xC20000;
const ASSETS_SIZE = 2 * 1024 * 1024;
const MAGIC_WCA1 = 0x31414357;
const TYPE_MAIN_GIF = 1;
const TYPE_GALLERY_IMAGE = 2;
const GIF_WIDTH = 84;
const GIF_HEIGHT = 84;
const GIF_FRAMES = 60;
const IMAGE_WIDTH = 220;
const IMAGE_HEIGHT = 208;
const MAX_IMAGES = 24;

const serialSupport = $("#serialSupport");
const connectSerialBtn = $("#connectSerialBtn");
const baudRate = $("#baudRate");
const serialState = $("#serialState");
const serialLog = $("#serialLog");
const clearLogBtn = $("#clearLogBtn");
const saveLogBtn = $("#saveLogBtn");
const sendForm = $("#sendForm");
const serialCommand = $("#serialCommand");
const rxBytes = $("#rxBytes");
const lastLineTime = $("#lastLineTime");
const cacheState = $("#cacheState");
const installAppBtn = $("#installAppBtn");

let port;
let reader;
let writer;
let keepReading = false;
let receivedBytes = 0;
let deferredInstallPrompt;
let installerScriptLoaded = false;
let convertedGif;
let convertedImages = [];
let generatedAssetPackage;
let selectedFirmware;
let selectedImagePreviewIndex = 0;
let gifPreviewTimer;
let gifPreviewFrames = [];
let gifOriginalUrl;

function setGifOriginalPreview(file) {
  if (gifOriginalUrl) URL.revokeObjectURL(gifOriginalUrl);
  gifOriginalUrl = URL.createObjectURL(file);
  const img = $("#gifOriginalPreview");
  img.src = gifOriginalUrl;
}

function nowText() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function appendLog(text) {
  if (serialLog.textContent === "等待连接设备串口...") serialLog.textContent = "";
  serialLog.textContent += text;
  serialLog.scrollTop = serialLog.scrollHeight;
  lastLineTime.textContent = nowText();
}

function appendWriteLog(text) {
  const log = $("#writeLog");
  if (log.textContent.startsWith("生成资源包后")) log.textContent = "";
  log.textContent += text;
  log.scrollTop = log.scrollHeight;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function setProgress(prefix, written, total) {
  const percent = total ? Math.min(100, Math.round(written / total * 100)) : 0;
  $(`#${prefix}Progress`).value = percent;
  $(`#${prefix}Percent`).textContent = `${percent}%`;
}

function setSerialSupport() {
  if ("serial" in navigator) {
    serialSupport.textContent = "Web Serial 可用";
    serialSupport.classList.add("is-ok");
    return;
  }
  serialSupport.textContent = "浏览器不支持串口";
  serialSupport.classList.add("is-warn");
  connectSerialBtn.disabled = true;
  $("#writeAssetsBtn").disabled = true;
  $("#eraseAssetsBtn").disabled = true;
  $("#writeFirmwareBtn").disabled = true;
}

async function disconnectSerial() {
  keepReading = false;
  try {
    if (reader) {
      await reader.cancel();
      reader.releaseLock();
    }
  } catch (error) {
    console.warn(error);
  }
  try {
    if (writer) writer.releaseLock();
  } catch (error) {
    console.warn(error);
  }
  try {
    if (port) await port.close();
  } catch (error) {
    console.warn(error);
  }
  reader = undefined;
  writer = undefined;
  port = undefined;
  connectSerialBtn.textContent = "连接串口";
  serialState.textContent = "未连接";
  appendLog(`\n[${nowText()}] 串口已断开\n`);
}

async function connectSerial() {
  if (port) {
    await disconnectSerial();
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: Number(baudRate.value) });
    writer = port.writable.getWriter();
    keepReading = true;
    connectSerialBtn.textContent = "断开串口";
    serialState.textContent = "已连接";
    appendLog(`[${nowText()}] 串口已连接，波特率 ${baudRate.value}\n`);
    readSerialLoop();
  } catch (error) {
    serialState.textContent = "连接失败";
    appendLog(`[${nowText()}] 连接失败：${error.message}\n`);
    port = undefined;
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoder();
  while (port?.readable && keepReading) {
    reader = port.readable.getReader();
    try {
      while (keepReading) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.byteLength;
          rxBytes.textContent = formatBytes(receivedBytes);
          appendLog(decoder.decode(value, { stream: true }));
        }
      }
    } catch (error) {
      appendLog(`[${nowText()}] 读取中断：${error.message}\n`);
    } finally {
      reader.releaseLock();
      reader = undefined;
    }
  }
}

async function sendSerialText(text) {
  if (!writer) {
    appendLog(`[${nowText()}] 尚未连接串口，未发送：${text}\n`);
    return false;
  }
  const payload = text.endsWith("\n") ? text : `${text}\n`;
  await writer.write(new TextEncoder().encode(payload));
  appendLog(`[${nowText()}] > ${payload}`);
  return true;
}

function drawFittedImage(ctx, img, fit, width, height) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (fit === "stretch") {
    ctx.drawImage(img, 0, 0, width, height);
    return;
  }
  const sourceWidth = img.videoWidth || img.naturalWidth || img.width;
  const sourceHeight = img.videoHeight || img.naturalHeight || img.height;
  const scale = fit === "cover" ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(img, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function applyEdgeFade(canvas, fadePixels) {
  const fade = Math.max(0, Math.min(fadePixels, Math.floor(Math.min(canvas.width, canvas.height) / 2)));
  if (fade === 0) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = imageData;
  for (let y = 0; y < height; y += 1) {
    const edgeY = Math.min(y, height - 1 - y);
    for (let x = 0; x < width; x += 1) {
      const edgeX = Math.min(x, width - 1 - x);
      const edgeDistance = Math.min(edgeX, edgeY);
      if (edgeDistance >= fade) continue;
      const t = Math.max(0, edgeDistance / fade);
      const mixWhite = 1 - (t * t * (3 - 2 * t));
      const offset = (y * width + x) * 4;
      data[offset] = data[offset] + (255 - data[offset]) * mixWhite;
      data[offset + 1] = data[offset + 1] + (255 - data[offset + 1]) * mixWhite;
      data[offset + 2] = data[offset + 2] + (255 - data[offset + 2]) * mixWhite;
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

function convertCanvasToOneBit(sourceCanvas, previewCanvas, threshold, dither, invert) {
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const previewCtx = previewCanvas.getContext("2d", { willReadFrequently: true });
  const source = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const output = previewCtx.createImageData(source.width, source.height);
  const gray = new Float32Array(source.width * source.height);

  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4;
    gray[i] = source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114;
  }

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = y * source.width + x;
      const oldValue = gray[index];
      const monoValue = oldValue >= threshold ? 255 : 0;
      let nextValue = monoValue;
      if (invert) nextValue = 255 - nextValue;
      const error = oldValue - monoValue;

      if (dither) {
        if (x + 1 < source.width) gray[index + 1] += error * 7 / 16;
        if (y + 1 < source.height) {
          if (x > 0) gray[index + source.width - 1] += error * 3 / 16;
          gray[index + source.width] += error * 5 / 16;
          if (x + 1 < source.width) gray[index + source.width + 1] += error * 1 / 16;
        }
      }

      const offset = index * 4;
      output.data[offset] = nextValue;
      output.data[offset + 1] = nextValue;
      output.data[offset + 2] = nextValue;
      output.data[offset + 3] = 255;
    }
  }

  previewCtx.putImageData(output, 0, 0);
  return packOneBit(output);
}

function stopGifPreview() {
  if (gifPreviewTimer) {
    clearInterval(gifPreviewTimer);
    gifPreviewTimer = undefined;
  }
}

function startGifPreview(frames) {
  stopGifPreview();
  gifPreviewFrames = frames;
  if (frames.length === 0) return;
  const ctx = $("#gifPreviewCanvas").getContext("2d");
  let index = 0;
  ctx.putImageData(frames[0], 0, 0);
  gifPreviewTimer = setInterval(() => {
    index = (index + 1) % frames.length;
    ctx.putImageData(frames[index], 0, 0);
  }, 120);
}

function packOneBit(imageData) {
  const rowBytes = Math.ceil(imageData.width / 8);
  const packed = new Uint8Array(rowBytes * imageData.height);
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const pixelIndex = (y * imageData.width + x) * 4;
      if (imageData.data[pixelIndex] < 128) packed[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return packed;
}

function packOneBitContinuous(imageData) {
  const bitCount = imageData.width * imageData.height;
  const packed = new Uint8Array(Math.ceil(bitCount / 8));
  for (let i = 0; i < bitCount; i += 1) {
    const pixelIndex = i * 4;
    if (imageData.data[pixelIndex] < 128) packed[i >> 3] |= 0x80 >> (i & 7);
  }
  return packed;
}

function unpackOneBitContinuousToImageData(packed, width, height, ctx) {
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i += 1) {
    const isBlack = (packed[i >> 3] & (0x80 >> (i & 7))) !== 0;
    const value = isBlack ? 0 : 255;
    const offset = i * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  return imageData;
}

function unpackOneBitRowsToImageData(packed, width, height, ctx) {
  const imageData = ctx.createImageData(width, height);
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isBlack = (packed[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      const value = isBlack ? 0 : 255;
      const offset = (y * width + x) * 4;
      imageData.data[offset] = value;
      imageData.data[offset + 1] = value;
      imageData.data[offset + 2] = value;
      imageData.data[offset + 3] = 255;
    }
  }
  return imageData;
}

function countPackedBlackBits(packed) {
  let count = 0;
  for (const byte of packed) {
    let value = byte;
    while (value) {
      value &= value - 1;
      count += 1;
    }
  }
  return count;
}

async function loadImageBitmapFromFile(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}

async function decodeGifFrames(file) {
  const bytes = await file.arrayBuffer();
  try {
    return await decodeGifFramesLocally(bytes);
  } catch (error) {
    console.warn(error);
  }
  if ("ImageDecoder" in window) {
    try {
      const decoder = new ImageDecoder({ data: bytes, type: "image/gif" });
      await decoder.tracks.ready;
      const frameCount = decoder.tracks.selectedTrack?.frameCount || GIF_FRAMES;
      const frames = [];
      const sampleIndices = sampleEvenlyByIndex(frameCount, GIF_FRAMES);
      for (const index of sampleIndices) {
        const decoded = await decoder.decode({ frameIndex: index });
        frames.push(decoded.image);
      }
      return frames;
    } catch (error) {
      console.warn(error);
    }
  }
  const fallback = await loadImageBitmapFromFile(file);
  return Array.from({ length: GIF_FRAMES }, () => fallback);
}

function sampleEvenlyByIndex(sourceCount, targetCount) {
  if (sourceCount <= 1) return Array.from({ length: targetCount }, () => 0);
  return Array.from({ length: targetCount }, (_item, index) => Math.min(sourceCount - 1, Math.floor(index * sourceCount / targetCount)));
}

function sampleGifTimeline(frames, targetCount) {
  if (frames.length === 0) return [];
  if (frames.length === 1) return Array.from({ length: targetCount }, () => frames[0].image);
  const durations = frames.map((frame) => Math.max(20, frame.durationMs || 100));
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const sampled = [];
  let frameIndex = 0;
  let frameEnd = durations[0];

  for (let i = 0; i < targetCount; i += 1) {
    const time = i * totalDuration / targetCount;
    while (frameIndex < frames.length - 1 && time >= frameEnd) {
      frameIndex += 1;
      frameEnd += durations[frameIndex];
    }
    sampled.push(frames[frameIndex].image);
  }

  return sampled;
}

class GifByteReader {
  constructor(buffer) {
    this.data = new Uint8Array(buffer);
    this.offset = 0;
  }

  readByte() {
    if (this.offset >= this.data.length) throw new Error("GIF 文件不完整");
    return this.data[this.offset++];
  }

  readUnsigned() {
    const low = this.readByte();
    const high = this.readByte();
    return low | (high << 8);
  }

  readBytes(length) {
    if (this.offset + length > this.data.length) throw new Error("GIF 文件不完整");
    const value = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readString(length) {
    return String.fromCharCode(...this.readBytes(length));
  }

  readSubBlocks() {
    const chunks = [];
    let total = 0;
    while (true) {
      const size = this.readByte();
      if (size === 0) break;
      const chunk = this.readBytes(size);
      chunks.push(chunk);
      total += chunk.length;
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  skipSubBlocks() {
    while (true) {
      const size = this.readByte();
      if (size === 0) break;
      this.offset += size;
      if (this.offset > this.data.length) throw new Error("GIF 文件不完整");
    }
  }
}

function readGifColorTable(reader, size) {
  const table = [];
  for (let i = 0; i < size; i += 1) {
    table.push([reader.readByte(), reader.readByte(), reader.readByte()]);
  }
  return table;
}

function decodeGifLzw(minCodeSize, data, expectedLength) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let bitPos = 0;
  let previous;
  const output = [];
  let dictionary = [];

  const resetDictionary = () => {
    dictionary = [];
    for (let i = 0; i < clearCode; i += 1) dictionary[i] = [i];
    dictionary[clearCode] = [];
    dictionary[endCode] = null;
    codeSize = minCodeSize + 1;
    previous = undefined;
  };

  const readCode = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i += 1) {
      const byte = data[bitPos >> 3];
      if (byte & (1 << (bitPos & 7))) code |= 1 << i;
      bitPos += 1;
    }
    return code;
  };

  resetDictionary();
  while (bitPos < data.length * 8 && output.length < expectedLength) {
    const code = readCode();
    if (code === clearCode) {
      resetDictionary();
      continue;
    }
    if (code === endCode) break;

    let entry;
    if (dictionary[code]) {
      entry = dictionary[code].slice();
    } else if (previous) {
      entry = previous.concat(previous[0]);
    } else {
      throw new Error("GIF LZW 数据无效");
    }

    output.push(...entry);
    if (previous) {
      dictionary.push(previous.concat(entry[0]));
      if (dictionary.length === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }

  return output.slice(0, expectedLength);
}

function deinterlaceGifPixels(pixels, width, height) {
  const output = new Uint8Array(width * height);
  let offset = 0;
  const passes = [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2]
  ];
  for (const [start, step] of passes) {
    for (let y = start; y < height; y += step) {
      output.set(pixels.slice(offset, offset + width), y * width);
      offset += width;
    }
  }
  return output;
}

async function decodeGifFramesLocally(bytes) {
  const reader = new GifByteReader(bytes);
  const signature = reader.readString(6);
  if (signature !== "GIF87a" && signature !== "GIF89a") throw new Error("不是有效的 GIF 文件");

  const logicalWidth = reader.readUnsigned();
  const logicalHeight = reader.readUnsigned();
  const packed = reader.readByte();
  const hasGlobalColorTable = (packed & 0x80) !== 0;
  const globalColorTableSize = 1 << ((packed & 0x07) + 1);
  reader.readByte();
  reader.readByte();
  const globalColorTable = hasGlobalColorTable ? readGifColorTable(reader, globalColorTableSize) : [];

  const compose = document.createElement("canvas");
  compose.width = logicalWidth;
  compose.height = logicalHeight;
  const composeCtx = compose.getContext("2d", { willReadFrequently: true });
  const frames = [];
  let gce = { disposal: 0, durationMs: 100, transparentIndex: undefined };

  while (reader.offset < reader.data.length) {
    const introducer = reader.readByte();
    if (introducer === 0x3b) break;

    if (introducer === 0x21) {
      const label = reader.readByte();
      if (label === 0xf9) {
        const blockSize = reader.readByte();
        const block = reader.readBytes(blockSize);
        reader.readByte();
        const delay = block[1] | (block[2] << 8);
        gce = {
          disposal: (block[0] >> 2) & 0x07,
          durationMs: delay > 0 ? delay * 10 : 100,
          transparentIndex: (block[0] & 0x01) ? block[3] : undefined
        };
      } else {
        reader.skipSubBlocks();
      }
      continue;
    }

    if (introducer !== 0x2c) throw new Error("GIF 块格式无效");

    const left = reader.readUnsigned();
    const top = reader.readUnsigned();
    const width = reader.readUnsigned();
    const height = reader.readUnsigned();
    const imagePacked = reader.readByte();
    const hasLocalColorTable = (imagePacked & 0x80) !== 0;
    const interlaced = (imagePacked & 0x40) !== 0;
    const localColorTableSize = 1 << ((imagePacked & 0x07) + 1);
    const colorTable = hasLocalColorTable ? readGifColorTable(reader, localColorTableSize) : globalColorTable;
    const minCodeSize = reader.readByte();
    const imageBytes = reader.readSubBlocks();
    let indices = decodeGifLzw(minCodeSize, imageBytes, width * height);
    if (interlaced) indices = deinterlaceGifPixels(indices, width, height);

    const beforeFrame = composeCtx.getImageData(0, 0, logicalWidth, logicalHeight);
    const imageData = composeCtx.getImageData(left, top, width, height);
    for (let i = 0; i < indices.length; i += 1) {
      const colorIndex = indices[i];
      if (colorIndex === gce.transparentIndex) continue;
      const color = colorTable[colorIndex] || [255, 255, 255];
      const offset = i * 4;
      imageData.data[offset] = color[0];
      imageData.data[offset + 1] = color[1];
      imageData.data[offset + 2] = color[2];
      imageData.data[offset + 3] = 255;
    }
    composeCtx.putImageData(imageData, left, top);
    frames.push({ image: await createImageBitmap(compose), durationMs: gce.durationMs });

    if (gce.disposal === 2) {
      composeCtx.clearRect(left, top, width, height);
    } else if (gce.disposal === 3) {
      composeCtx.putImageData(beforeFrame, 0, 0);
    }
    gce = { disposal: 0, durationMs: 100, transparentIndex: undefined };
  }

  if (!frames.length) throw new Error("GIF 没有可解码帧");
  return sampleGifTimeline(frames, GIF_FRAMES);
}

async function convertGif() {
  const file = $("#gifInput").files?.[0];
  if (!file) {
    $("#assetResult").textContent = "请先选择一个 GIF 文件。";
    return;
  }
  if (file.type !== "image/gif" && !file.name.toLowerCase().endsWith(".gif")) {
    $("#assetResult").textContent = "动图区域只支持 GIF 文件。";
    return;
  }

  setGifOriginalPreview(file);
  $("#assetResult").textContent = "正在解析并转换 GIF...";
  const frames = await decodeGifFrames(file);
  const source = $("#gifSourceCanvas");
  const preview = $("#gifPreviewCanvas");
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const previewCtx = preview.getContext("2d", { willReadFrequently: true });
  const fit = $("#gifFit").value;
  const threshold = Number($("#gifThreshold").value);
  const dither = $("#gifDither").checked;
  const invert = $("#gifInvert").checked;
  const packedFrames = [];
  const previewFrames = [];
  let blackBits = 0;

  for (let i = 0; i < GIF_FRAMES; i += 1) {
    drawFittedImage(sourceCtx, frames[i], fit, GIF_WIDTH, GIF_HEIGHT);
    convertCanvasToOneBit(source, preview, threshold, dither, invert);
    const convertedFrame = previewCtx.getImageData(0, 0, GIF_WIDTH, GIF_HEIGHT);
    const packed = packOneBitContinuous(convertedFrame);
    packedFrames.push(packed);
    previewFrames.push(unpackOneBitContinuousToImageData(packed, GIF_WIDTH, GIF_HEIGHT, previewCtx));
    blackBits += countPackedBlackBits(packed);
  }

  const frameBytes = GIF_WIDTH * GIF_HEIGHT / 8;
  const payload = new Uint8Array(frameBytes * GIF_FRAMES);
  packedFrames.forEach((frame, index) => payload.set(frame, index * frameBytes));
  convertedGif = { type: TYPE_MAIN_GIF, index: 0, width: GIF_WIDTH, height: GIF_HEIGHT, frameCount: GIF_FRAMES, bytesPerRow: 0, data: payload };
  startGifPreview(previewFrames);
  invalidateGeneratedAssets();
  const density = Math.round(blackBits / (GIF_WIDTH * GIF_HEIGHT * GIF_FRAMES) * 100);
  const warning = blackBits === 0 ? "当前转换结果没有黑色像素，请尝试调高阈值或开启反色。" : "右侧预览正在循环播放转换后的效果。";
  $("#assetResult").textContent = `GIF 已转换：${GIF_WIDTH}×${GIF_HEIGHT}，按完整播放区间均匀抽取 ${GIF_FRAMES} 帧，整帧连续 bitstream，${formatBytes(payload.byteLength)}，黑色像素约 ${density}%。${warning}`;
}

async function previewSelectedGif() {
  stopGifPreview();
  convertedGif = undefined;
  invalidateGeneratedAssets();
  const file = $("#gifInput").files?.[0];
  if (!file) return;
  if (file.type !== "image/gif" && !file.name.toLowerCase().endsWith(".gif")) {
    $("#assetResult").textContent = "动图区域只支持 GIF 文件。";
    return;
  }
  setGifOriginalPreview(file);
  const frames = await decodeGifFrames(file);
  const source = $("#gifSourceCanvas");
  const preview = $("#gifPreviewCanvas");
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const previewCtx = preview.getContext("2d", { willReadFrequently: true });
  drawFittedImage(sourceCtx, frames[0], $("#gifFit").value, GIF_WIDTH, GIF_HEIGHT);
  previewCtx.clearRect(0, 0, GIF_WIDTH, GIF_HEIGHT);
  $("#assetResult").textContent = `已载入 GIF：${file.name}。点击“转换 GIF”查看 1-bit 动图预览。`;
}

async function convertImages() {
  const files = getSelectedImageFiles();
  if (files.length === 0) {
    $("#assetResult").textContent = "请先选择静图文件。";
    return;
  }
  $("#assetResult").textContent = "正在转换静图...";
  convertedImages = [];
  const source = $("#imageSourceCanvas");
  const preview = $("#imagePreviewCanvas");
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const fit = $("#imageFit").value;
  const threshold = Number($("#imageThreshold").value);
  const edgeFade = Number($("#imageEdgeFade").value);
  const dither = $("#imageDither").checked;
  const invert = $("#imageInvert").checked;

  for (const [index, file] of files.entries()) {
    const image = await loadImageBitmapFromFile(file);
    drawFittedImage(sourceCtx, image, fit, IMAGE_WIDTH, IMAGE_HEIGHT);
    applyEdgeFade(source, edgeFade);
    const packed = convertCanvasToOneBit(source, preview, threshold, dither, invert);
    convertedImages.push({ type: TYPE_GALLERY_IMAGE, index, width: IMAGE_WIDTH, height: IMAGE_HEIGHT, frameCount: 1, bytesPerRow: Math.ceil(IMAGE_WIDTH / 8), data: packed, name: file.name });
  }

  updateImageList(files);
  await previewSelectedImages({ keepConverted: true });
  invalidateGeneratedAssets();
  $("#assetResult").textContent = `静图已转换：${convertedImages.length} 张，每张 ${IMAGE_WIDTH}×${IMAGE_HEIGHT}。预览显示第 ${selectedImagePreviewIndex + 1} 张。`;
}

function getSelectedImageFiles() {
  return Array.from($("#imageInput").files || []).slice(0, MAX_IMAGES);
}

function updateImagePreviewSelect(files) {
  const select = $("#imagePreviewSelect");
  select.innerHTML = "";
  if (files.length === 0) {
    select.disabled = true;
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "尚未选择静图";
    select.appendChild(option);
    return;
  }
  select.disabled = false;
  files.forEach((file, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index + 1}. ${file.name}`;
    select.appendChild(option);
  });
  selectedImagePreviewIndex = Math.min(selectedImagePreviewIndex, files.length - 1);
  select.value = String(selectedImagePreviewIndex);
}

function updateImageList(files) {
  if (files.length === 0) {
    $("#imageList").textContent = "尚未选择静图。";
    return;
  }
  const converted = new Set(convertedImages.map((item) => item.index));
  $("#imageList").textContent = files.map((file, index) => {
    const suffix = converted.has(index) ? "已转换" : "待转换";
    return `${index + 1}. ${file.name} / ${suffix}`;
  }).join("\n");
}

function invalidateGeneratedAssets() {
  generatedAssetPackage = undefined;
  $("#downloadAssetsBtn").disabled = true;
  $("#writeAssetsBtn").disabled = true;
  $("#assetWriteState").textContent = "等待资源包";
}

function clearGifConversion() {
  stopGifPreview();
  convertedGif = undefined;
  invalidateGeneratedAssets();
  const preview = $("#gifPreviewCanvas");
  preview.getContext("2d", { willReadFrequently: true }).clearRect(0, 0, GIF_WIDTH, GIF_HEIGHT);
  $("#assetResult").textContent = "已清除 GIF 转换结果。已选择的 GIF 文件仍保留，可重新转换。";
}

function clearImageConversions() {
  convertedImages = [];
  invalidateGeneratedAssets();
  const preview = $("#imagePreviewCanvas");
  preview.getContext("2d", { willReadFrequently: true }).clearRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  updateImageList(getSelectedImageFiles());
  $("#assetResult").textContent = "已清除静图转换结果。已选择的静图文件仍保留，可重新转换。";
}

async function previewSelectedImages({ keepConverted = false } = {}) {
  if (!keepConverted) {
    convertedImages = [];
    invalidateGeneratedAssets();
  }
  const files = getSelectedImageFiles();
  if (files.length === 0) {
    updateImagePreviewSelect(files);
    $("#imageList").textContent = "尚未选择静图。";
    return;
  }
  updateImagePreviewSelect(files);
  const image = await loadImageBitmapFromFile(files[selectedImagePreviewIndex]);
  const source = $("#imageSourceCanvas");
  const preview = $("#imagePreviewCanvas");
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const previewCtx = preview.getContext("2d", { willReadFrequently: true });
  drawFittedImage(sourceCtx, image, $("#imageFit").value, IMAGE_WIDTH, IMAGE_HEIGHT);
  applyEdgeFade(source, Number($("#imageEdgeFade").value));
  const converted = convertedImages.find((item) => item.index === selectedImagePreviewIndex);
  if (converted) {
    previewCtx.putImageData(unpackOneBitRowsToImageData(converted.data, IMAGE_WIDTH, IMAGE_HEIGHT, previewCtx), 0, 0);
  } else {
    previewCtx.clearRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  }
  updateImageList(files);
  if (!keepConverted) {
    $("#assetResult").textContent = `已选择 ${files.length} 张静图，最多会转换前 ${MAX_IMAGES} 张。当前预览第 ${selectedImagePreviewIndex + 1} 张，点击“转换静图”查看 1-bit 预览。`;
  }
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrc32Table();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildAssetPackage() {
  const entries = [];
  if (convertedGif) entries.push(convertedGif);
  entries.push(...convertedImages);
  if (entries.length === 0) {
    $("#assetResult").textContent = "请先转换 GIF 或静图。";
    return;
  }

  const headerSize = 24 + entries.length * 24;
  const payloadSize = entries.reduce((sum, entry) => sum + entry.data.byteLength, 0);
  const totalSize = headerSize + payloadSize;
  if (totalSize > ASSETS_SIZE) {
    $("#assetResult").textContent = `资源包超过 assets 分区大小：${formatBytes(totalSize)} / ${formatBytes(ASSETS_SIZE)}。`;
    return;
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = headerSize;
  view.setUint32(0, MAGIC_WCA1, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, headerSize, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, 0, true);
  view.setUint32(12, totalSize, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, 0, true);

  entries.forEach((entry, entryIndex) => {
    const base = 24 + entryIndex * 24;
    view.setUint16(base, entry.type, true);
    view.setUint16(base + 2, entry.index, true);
    view.setUint16(base + 4, entry.width, true);
    view.setUint16(base + 6, entry.height, true);
    view.setUint16(base + 8, entry.frameCount, true);
    view.setUint16(base + 10, entry.bytesPerRow, true);
    view.setUint32(base + 12, offset, true);
    view.setUint32(base + 16, entry.data.byteLength, true);
    view.setUint32(base + 20, crc32(entry.data), true);
    bytes.set(entry.data, offset);
    offset += entry.data.byteLength;
  });

  const payloadCrc = crc32(bytes.slice(headerSize));
  view.setUint32(20, payloadCrc, true);
  view.setUint32(16, 0, true);
  const headerCrc = crc32(bytes.slice(0, headerSize));
  view.setUint32(16, headerCrc, true);

  generatedAssetPackage = new Uint8Array(buffer);
  $("#downloadAssetsBtn").disabled = false;
  $("#writeAssetsBtn").disabled = !("serial" in navigator);
  $("#assetWriteState").textContent = `资源包已生成：${formatBytes(totalSize)}`;
  $("#assetResult").textContent = `资源包已生成：${entries.length} 个资源，${formatBytes(totalSize)}。`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadAssets() {
  if (!generatedAssetPackage) return;
  downloadBlob(new Blob([generatedAssetPackage], { type: "application/octet-stream" }), "custom_assets.bin");
}

function downloadLog() {
  downloadBlob(new Blob([serialLog.textContent], { type: "text/plain;charset=utf-8" }), `weather-clock-serial-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
}

async function importEsptool() {
  const urls = [
    "https://unpkg.com/esptool-js@0.5.6/bundle.js",
    "https://cdn.jsdelivr.net/npm/esptool-js@0.5.6/bundle.js"
  ];
  let lastError;
  for (const url of urls) {
    try {
      return await import(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`烧录模块加载失败：${lastError?.message || "网络不可用"}`);
}

function uint8ArrayToBinaryString(bytes) {
  const chunkSize = 0x8000;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    let text = "";
    for (let j = 0; j < chunk.length; j += 1) text += String.fromCharCode(chunk[j]);
    chunks.push(text);
  }
  return chunks.join("");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setSerialSignals(transport, device, signals) {
  if ("dataTerminalReady" in signals && typeof transport.setDTR === "function") {
    await transport.setDTR(Boolean(signals.dataTerminalReady));
  }
  if ("requestToSend" in signals && typeof transport.setRTS === "function") {
    await transport.setRTS(Boolean(signals.requestToSend));
  }
  if (typeof device.setSignals === "function") {
    await device.setSignals(signals);
  }
}

async function resetDeviceAfterFlash(transport, device, log) {
  log("正在复位设备...\n");
  try {
    await setSerialSignals(transport, device, { dataTerminalReady: false, requestToSend: false });
    await wait(80);
    await setSerialSignals(transport, device, { dataTerminalReady: false, requestToSend: true });
    await wait(120);
    await setSerialSignals(transport, device, { dataTerminalReady: false, requestToSend: false });
    await wait(250);
    log("复位信号已发送。\n");
  } catch (error) {
    log(`复位信号发送失败：${error.message}\n`);
    log("如果设备没有自动启动，请短按 RST 或重新插拔 USB。\n");
  }
}

async function writeBinaryWithEsptool({ data, offset, baudRateValue, stateId, percentId, progressId, log, eraseSize }) {
  if (!("serial" in navigator)) throw new Error("当前浏览器不支持 Web Serial。请使用 Chrome 或 Edge。");
  const esptool = await importEsptool();
  const device = await navigator.serial.requestPort();
  const Transport = esptool.Transport;
  const ESPLoader = esptool.ESPLoader;
  const transport = new Transport(device, true);
  const terminal = { clean: () => {}, writeLine: (line) => log(`${line}\n`), write: (text) => log(text) };
  const loader = new ESPLoader({ transport, baudrate: Number(baudRateValue), terminal });
  $(`#${stateId}`).textContent = "连接设备中";
  await loader.main();
  $(`#${stateId}`).textContent = "写入中";
  const binary = data instanceof Uint8Array ? data : new Uint8Array(data);
  const binaryString = uint8ArrayToBinaryString(binary);
  await loader.writeFlash({
    fileArray: [{ data: binaryString, address: offset }],
    flashSize: "keep",
    eraseAll: false,
    compress: true,
    reportProgress: (_fileIndex, written, total) => {
      const percent = total ? Math.min(100, Math.round(written / total * 100)) : 0;
      $(`#${progressId}`).value = percent;
      $(`#${percentId}`).textContent = `${percent}%`;
      $(`#${stateId}`).textContent = `写入中 ${formatBytes(written)} / ${formatBytes(total)}`;
    }
  });
  if (eraseSize) log(`写入范围：0x${offset.toString(16)} + ${formatBytes(eraseSize)}\n`);
  $(`#${progressId}`).value = 100;
  $(`#${percentId}`).textContent = "100%";
  $(`#${stateId}`).textContent = "写入完成，正在复位";
  await resetDeviceAfterFlash(transport, device, log);
  $(`#${stateId}`).textContent = "写入完成，设备已复位";
  await transport.disconnect();
}

async function writeAssets() {
  if (!generatedAssetPackage) {
    appendWriteLog("请先生成资源包。\n");
    return;
  }
  setProgress("assetWrite", 0, 100);
  appendWriteLog(`[${nowText()}] 开始写入 custom_assets.bin 到 0x${ASSETS_OFFSET.toString(16)}\n`);
  try {
    await writeBinaryWithEsptool({
      data: generatedAssetPackage,
      offset: ASSETS_OFFSET,
      baudRateValue: $("#assetBaudRate").value,
      stateId: "assetWriteState",
      percentId: "assetWritePercent",
      progressId: "assetWriteProgress",
      log: appendWriteLog,
      eraseSize: generatedAssetPackage.byteLength
    });
    appendWriteLog(`[${nowText()}] 资源写入完成。\n`);
  } catch (error) {
    $("#assetWriteState").textContent = "写入失败";
    appendWriteLog(`[${nowText()}] 写入失败：${error.message}\n`);
  }
}

async function eraseAssets() {
  const erasedHeader = new Uint8Array(4096).fill(0xFF);
  setProgress("assetWrite", 0, 100);
  appendWriteLog(`[${nowText()}] 开始清空资源分区头部 0x${ASSETS_OFFSET.toString(16)}\n`);
  try {
    await writeBinaryWithEsptool({
      data: erasedHeader,
      offset: ASSETS_OFFSET,
      baudRateValue: $("#assetBaudRate").value,
      stateId: "assetWriteState",
      percentId: "assetWritePercent",
      progressId: "assetWriteProgress",
      log: appendWriteLog,
      eraseSize: erasedHeader.byteLength
    });
    appendWriteLog(`[${nowText()}] 资源分区已清空，设备会回退到内置素材。\n`);
  } catch (error) {
    $("#assetWriteState").textContent = "清空失败";
    appendWriteLog(`[${nowText()}] 清空失败：${error.message}\n`);
  }
}

async function writeFirmware() {
  if (!selectedFirmware) return;
  const offset = Number.parseInt($("#firmwareOffset").value.trim(), 16);
  if (!Number.isFinite(offset)) {
    $("#flashResult").textContent = "写入地址无效，请使用 0x0 这样的十六进制格式。";
    return;
  }
  const data = new Uint8Array(await selectedFirmware.arrayBuffer());
  $("#firmwareWriteState").textContent = `准备写入 ${selectedFirmware.name}`;
  try {
    await writeBinaryWithEsptool({
      data,
      offset,
      baudRateValue: $("#firmwareBaudRate").value,
      stateId: "firmwareWriteState",
      percentId: "firmwareWritePercent",
      progressId: "firmwareWriteProgress",
      log: (text) => { $("#flashResult").textContent = text.trim() || $("#flashResult").textContent; }
    });
    $("#flashResult").textContent = "完整固件烧录完成，设备正在重启。";
  } catch (error) {
    $("#firmwareWriteState").textContent = "烧录失败";
    $("#flashResult").textContent = `烧录失败：${error.message}`;
  }
}

async function loadInstaller() {
  const mount = $("#installerMount");
  if (!installerScriptLoaded) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src = "https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module";
      script.onload = resolve;
      script.onerror = () => reject(new Error("烧录器组件加载失败，请确认网络可访问 unpkg.com。"));
      document.head.appendChild(script);
    });
    installerScriptLoaded = true;
  }
  mount.textContent = "";
  const button = document.createElement("esp-web-install-button");
  button.setAttribute("manifest", "./firmware/manifest.json");
  mount.appendChild(button);
}

function bindTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((item) => item.classList.remove("is-active"));
      $$(".tab-panel").forEach((panel) => panel.classList.remove("is-active"));
      tab.classList.add("is-active");
      $(`#${tab.dataset.tab}`).classList.add("is-active");
    });
  });
}

function bindInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installAppBtn.disabled = false;
  });
  installAppBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = undefined;
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    cacheState.textContent = "当前浏览器不支持离线缓存";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    cacheState.textContent = registration.active ? "离线缓存已启用" : "离线缓存已注册";
  } catch (error) {
    cacheState.textContent = `离线缓存失败：${error.message}`;
  }
}

bindTabs();
bindInstall();
setSerialSupport();
registerServiceWorker();

connectSerialBtn.addEventListener("click", connectSerial);
clearLogBtn.addEventListener("click", () => {
  serialLog.textContent = "";
  receivedBytes = 0;
  rxBytes.textContent = "0 B";
  lastLineTime.textContent = "-";
});
saveLogBtn.addEventListener("click", downloadLog);
sendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const command = serialCommand.value.trim();
  if (!command) return;
  await sendSerialText(command);
  serialCommand.value = "";
});

$("#gifThreshold").addEventListener("input", () => { $("#gifThresholdValue").textContent = $("#gifThreshold").value; });
$("#imageThreshold").addEventListener("input", () => { $("#imageThresholdValue").textContent = $("#imageThreshold").value; });
$("#imageEdgeFade").addEventListener("input", () => {
  $("#imageEdgeFadeValue").textContent = $("#imageEdgeFade").value;
  previewSelectedImages({ keepConverted: convertedImages.length > 0 }).catch((error) => { $("#assetResult").textContent = `静图预览失败：${error.message}`; });
});
$("#gifInput").addEventListener("change", () => {
  previewSelectedGif().catch((error) => { $("#assetResult").textContent = `GIF 预览失败：${error.message}`; });
});
$("#imageInput").addEventListener("change", () => {
  selectedImagePreviewIndex = 0;
  previewSelectedImages().catch((error) => { $("#assetResult").textContent = `静图预览失败：${error.message}`; });
});
$("#gifFit").addEventListener("change", () => {
  previewSelectedGif().catch((error) => { $("#assetResult").textContent = `GIF 预览失败：${error.message}`; });
});
$("#imageFit").addEventListener("change", () => {
  previewSelectedImages().catch((error) => { $("#assetResult").textContent = `静图预览失败：${error.message}`; });
});
$("#imagePreviewSelect").addEventListener("change", () => {
  selectedImagePreviewIndex = Number($("#imagePreviewSelect").value) || 0;
  previewSelectedImages({ keepConverted: convertedImages.length > 0 }).catch((error) => { $("#assetResult").textContent = `静图预览失败：${error.message}`; });
});
$("#previewGifBtn").addEventListener("click", () => convertGif().catch((error) => { $("#assetResult").textContent = `GIF 转换失败：${error.message}`; }));
$("#clearGifBtn").addEventListener("click", clearGifConversion);
$("#previewImagesBtn").addEventListener("click", () => convertImages().catch((error) => { $("#assetResult").textContent = `静图转换失败：${error.message}`; }));
$("#clearImagesBtn").addEventListener("click", clearImageConversions);
$("#buildAssetsBtn").addEventListener("click", buildAssetPackage);
$("#downloadAssetsBtn").addEventListener("click", downloadAssets);
$("#writeAssetsBtn").addEventListener("click", writeAssets);
$("#eraseAssetsBtn").addEventListener("click", eraseAssets);
$("#firmwareInput").addEventListener("change", () => {
  selectedFirmware = $("#firmwareInput").files?.[0];
  $("#writeFirmwareBtn").disabled = !selectedFirmware || !("serial" in navigator);
  $("#firmwareWriteState").textContent = selectedFirmware ? `${selectedFirmware.name} / ${formatBytes(selectedFirmware.size)}` : "等待固件文件";
});
$("#writeFirmwareBtn").addEventListener("click", writeFirmware);
$("#loadInstallerBtn").addEventListener("click", () => {
  loadInstaller().catch((error) => { $("#flashResult").textContent = error.message; });
});
