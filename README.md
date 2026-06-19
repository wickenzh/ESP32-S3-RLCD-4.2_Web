# WeatherClock GitHub Pages 上位机

这是一个纯静态网页上位机，可直接通过 GitHub Pages 发布，也可以单独上传到上位机专用仓库运行。

## 发布方式

1. 推送仓库到 GitHub。
2. 打开仓库 `Settings / Pages`。
3. Source 选择 `Deploy from a branch`。
4. 如果使用上位机专用仓库，把 `host_web/` 的内容放到该仓库根目录，Branch 选择 `main`，Folder 选择 `/ (root)`。
5. 专用仓库发布后访问：

```text
https://<username>.github.io/<host-repo>/
```

`assets/` 中的预览图已经包含在上位机目录内，不依赖本项目仓库的其他路径。

## 本地预览

Web Serial 需要安全上下文。本地开发请使用 HTTPS 预览：

```sh
cd host_web
node dev_https_server.mjs
```

首次启动会自动生成 `.dev_certs/` 下的自签名证书。浏览器打开 `https://127.0.0.1:4173/` 后，需要手动信任本地证书提示。

## 当前功能

- Web Serial 串口日志读取、命令发送、日志保存。
- 图片资源制作：静图支持 JPG、PNG、WebP、BMP 等浏览器可读图片，转换为 `220×208`、1-bit packed。
- GIF 资源制作：动图只支持 GIF，转换为 `84×84`、60 帧、整帧连续 1-bit bitstream。
- 资源写入：生成 `custom_assets.bin` 后，通过串口写入设备 `assets` 分区 `0xC20000`，显示写入进度。
- 固件烧录：用户自行选择完整 merged bin，通过串口从 `0x0` 写入设备，显示烧录进度。
- 离线缓存，便于打开页面后再切换到设备 AP。

## 完整烧录目录

专用 Pages 仓库建议放置：

```text
firmware/
  manifest.json
  weather_clock_vX.X.X_merged.bin
```

`firmware/manifest.example.json` 是当前项目的 ESP32-S3 完整烧录示例。ESP Web Tools 对 ESP-IDF v4+ 固件推荐使用 `esptool merge_bin` 生成的单个 merged bin，并写入 `0x0`。

当前完整镜像由这些构建产物合并而来，默认偏移来自 `RLCD_CLOCK/build/flash_args`：

- `0x0`：`bootloader/bootloader.bin`
- `0x8000`：`partition_table/partition-table.bin`
- `0xf000`：`ota_data_initial.bin`
- `0x20000`：`weather_clock.bin`

## 浏览器要求

Web Serial 需要 HTTPS 和 Chromium 内核浏览器，例如 Chrome 或 Edge。
