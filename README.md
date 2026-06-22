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

## 在线预览

当前 GitHub Pages 访问地址：

```text
https://wickenzh.github.io/ESP32-S3-RLCD-4.2_Web/
```

## 当前功能

- Web Serial 串口日志读取、命令发送、日志保存。
- 图片资源制作：静图支持 JPG、PNG、WebP、BMP 等浏览器可读图片，转换为 `220×208`、1-bit packed。
- GIF 资源制作：动图只支持 GIF，转换为 `84×84`、60 帧、整帧连续 1-bit bitstream。
- 资源写入：先选择设备并读取分区表，确认 `assets` 分区为 `0xC20000` / `2M` 后，才能串口写入或清空资源分区。
- 固件烧录：默认从 `wickenzh/ESP32-S3-RLCD-4.2_UP` 最新 GitHub Release 选择 `merged.bin`，下载后校验 SHA-256，通过后才允许串口烧录；也支持用户自行选择完整 merged bin。
- 离线缓存，便于打开页面后再切换到设备 AP。

## 在线固件仓库

默认固件来源：

```text
https://github.com/wickenzh/ESP32-S3-RLCD-4.2_UP
```

网页读取：

```text
https://api.github.com/repos/wickenzh/ESP32-S3-RLCD-4.2_UP/releases/latest
```

最新 Release 中需要提供 `merged.bin`，并需要可核对的 SHA-256：优先使用 GitHub Release asset 的 `digest` 字段，也支持同一 Release 内的 `merged.bin.sha256`、`SHA256SUMS`、`SHA256SUMS.txt` 或 `sha256.txt`。网页下载固件后会计算 SHA-256，只有与记录一致才会启用烧录。

`firmware/manifest.example.json` 是 ESP Web Tools 示例。ESP-IDF v4+ 固件推荐使用 `esptool merge_bin` 生成的单个 merged bin，并写入 `0x0`。

当前完整镜像由这些构建产物合并而来，默认偏移来自 `RLCD_CLOCK/build/flash_args`：

- `0x0`：`bootloader/bootloader.bin`
- `0x8000`：`partition_table/partition-table.bin`
- `0xf000`：`ota_data_initial.bin`
- `0x20000`：`weather_clock.bin`

## 浏览器要求

Web Serial 需要 HTTPS 和 Chromium 内核浏览器，例如 Chrome 或 Edge。
