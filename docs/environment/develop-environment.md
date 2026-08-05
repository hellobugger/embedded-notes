# 开发环境搭建

> 从零到能编译、下载、调试的各种开发环境搭建记录，按「环境」分节，持续补充。先写 Keil5 + CubeMX，后续补充 CubeIDE、VSCode + PlatformIO 等。

## 一、环境总览

| 环境                | 适用场景                         | 状态   |
| ------------------- | -------------------------------- | ------ |
| Keil5 + STM32CubeMX | STM32 裸机/寄存器开发，老工程多  | ✅ 已写 |
| STM32CubeIDE        | STM32 一体化 IDE，免费无代码限制 | ⏳ 待写 |
| VSCode + PlatformIO | Arduino / 多平台 / 快捷键党      | ⏳ 待写 |

---

## 二、Keil5 + STM32CubeMX

这套是 STM32 最主流的工作流：CubeMX 可视化配置外设、生成初始化代码，Keil 负责编译、下载、调试。

### 1. 安装 Keil5（MDK-ARM）

1. 到 Keil 官网下载 MDK-ARM：<https://www.keil.com/download/product/>
2. 一路下一步安装。**路径不要含中文**，默认的 `C:\Keil_v5` 即可
3. 安装完用 **Pack Installer** 补装目标芯片的器件包（DFP）：
   - 菜单 `Project → Manage → Pack Installer`
   - 在线搜索并安装对应系列，如 `Keil::STM32F1xx_DFP` / `Keil::STM32F4xx_DFP`
   - 网不好可到 <https://www.keil.com/dd2/pack/> 下离线包手动装

!!! warning "关于 License"
    MDK 免费评估版有 **32KB 代码量限制**，超了编译报 `code size limit`。正式开发需购买 License；想免费无限制就换 STM32CubeIDE，功能基本等价，邪修请参考网上教程，这个不做细说。

### 2. 安装 STM32CubeMX

1. 到 ST 官网下载：<https://www.st.com/en/development-tools/stm32cubemx.html>（需注册 ST 账号）
2. 新版安装包自带 Java 运行时；老版本启动若报缺 Java，装一个 JRE 8 即可
3. 首次建工程时会提示下载芯片固件包（STM32CubeF1/F4 等）。也可在 `Help → Manage embedded software packages` 里提前下载。
4. 还要注意的就是芯片固件包的存放地址，这个需要自己设置，不然默认就是存在电脑的C盘，C盘够大的不用管，否则可以到 `Help → Updater Settings → Firmware Repository → Repository Folder` 进行设置。

### 3. CubeMX 生成 Keil 工程（点灯为例）

1. `File → New Project` → 在 MCU Selector 里搜索选型（如 `STM32F103C8T6`）
2. **System Core → RCC → HSE**：板上有外部晶振就选 `Crystal/Ceramic Resonator`，否则保持 `Disable`（用内部时钟）
3. **Clock Configuration**：把 `HCLK` 设为目标频率（如 F103 拉满 72MHz），PLL 会自动配好
4. 配置外设：如把 `PA5` 设为 `GPIO_Output` 接 LED
5. **Project Manager** 页：
   - 工程名和**存放路径不能含中文**
   - `Toolchain / IDE` 选 **MDK-ARM**，`Version` 选 **V5**（对应你装的 MDK5）
   - 建议勾上 `Copy all used libraries into the project folder`，虽然工程占用内存大，但是方便可以在别的电脑也打开。
   - 建议勾上 `Generate peripheral initialization as a pair of '.c/.h' files per peripheral`，生成的外设都会有独立的 .c/.h 文件，不然会显得工程内部文件混乱。
6. 点右上角 **GENERATE CODE** 生成，完成后打开生成的 `.uvprojx`
7. 个人建议，堆栈大小还是自己设置一下，防止新手操作过程中，因为可分配的堆栈太小，导致堆栈的溢出，在 `Project Manager → Project Settings → Linker Settings` 的 `Minimum Heap Size` 和 `Minimum Stack Size` 可以设置。默认堆/栈偏小（各 0x200/0x400），跑 RTOS 或 printf 容易被坑。

### 4. Keil 编译、下载、调试

1. 双击打开 `.uvprojx`，先 `Options for Target → Device` 确认芯片型号（CubeMX 已配好）
2. 配下载器：`Options for Target → Debug` → 下拉选 `ST-Link Debugger` 或 `CMSIS-DAP Debugger` → 右边 `Settings`：
   - **Flash Download → 勾选 Reset and Run**，下载完自动运行
   - 确认 Programming Algorithm 里有对应 Flash 算法（CubeMX 生成时已带）
3. 板子接上 SWD 四根线（SWDIO / SWCLK / GND / 3V3），`F7` 编译、`F8`（LOAD）下载
4. `F5` 进调试，可打断点、看变量、单步

### 5. 避坑备忘

- **中文路径**：CubeMX 工程和 Keil 安装路径含中文会出各种诡异编译/下载问题，一律用英文路径
- **中文注释乱码**：CubeMX 生成的源文件是 UTF-8，Keil 5 默认按本地编码解码 → `Edit → Configuration → Editor → Encoding` 改为 **UTF-8**
- **缺器件/头文件**：报找不到 `stm32f1xx.h` 或 Device 不存在，就是对应 DFP 没装
- **下载后不运行**：多半是 `Reset and Run` 没勾
- **改的代码被覆盖**：CubeMX 重新生成会覆盖 `.c/.h`，自己的代码要写在 `/* USER CODE BEGIN/END */` 区块里

---
