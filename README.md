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
- 固件烧录：写入目标使用固定下拉菜单。在线固件使用 `app.url`，可写入 `ota_0`、`ota_1` 或同时写入两个 OTA app 分区；`bootloader.bin`、`partition-table.bin`、`ota_data_initial.bin` 需要切换为自定义文件并选择对应目标。
- 离线缓存，便于打开页面后再切换到设备 AP。

## 在线固件仓库

默认固件清单来源：

```text
https://rlcd-update.wickenzh.workers.dev/firmware/versions.json
```

设备 OTA 检查最新版本使用：

```text
https://rlcd-update.wickenzh.workers.dev/firmware/latest.json
```

上位机优先读取 `versions.json`，不读取 GitHub Release，不扫描 GitHub 仓库里的 bin 文件，也不直接访问 R2 Bucket。`items` 中每个版本需要同时提供 `app` 和 `merged` 的 `url`、`sha256`、`size`。串口刷写 OTA app 分区时使用 `app.url`。网页下载固件后会计算本地 SHA-256，只有与清单记录完全一致才会启用后续操作；大小或 SHA-256 不一致会清除本次下载并提示重新下载。

如果 `versions.json` 暂时不可用，页面会降级读取 `latest.json` 来显示当前最新 OTA app 包，避免在线固件区域直接加载失败。

`firmware/manifest.example.json` 是 ESP Web Tools 示例。ESP-IDF v4+ 固件推荐使用 `esptool merge_bin` 生成的单个 merged bin，并写入 `0x0`。

当前完整镜像由这些构建产物合并而来，默认偏移来自 `RLCD_CLOCK/build/flash_args`：

- `0x0`：`bootloader/bootloader.bin`
- `0x8000`：`partition_table/partition-table.bin`
- `0xf000`：`ota_data_initial.bin`
- `0x20000`：`weather_clock.bin`

## 浏览器要求

Web Serial 需要 HTTPS 和 Chromium 内核浏览器，例如 Chrome 或 Edge。
