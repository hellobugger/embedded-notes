# 开发环境搭建

> 从零到能编译、下载、调试的各种开发环境搭建记录，按「环境」分节，持续补充。先写 Keil5 + CubeMX，后续补充 CubeIDE、VSCode + PlatformIO 等。

## 一、环境总览

| 环境                | 适用场景                                 | 状态   |
| ------------------- | ---------------------------------------- | ------ |
| Keil5 + STM32CubeMX | STM32 裸机/寄存器开发，老工程多          | ✅ 已写 |
| Keil C51 / C251     | STC / 8051 单片机，与 MDK-ARM 共存       | ✅ 已写 |
| VSCode + EIDE       | 用 VSCode 打开 Keil 工程，体验现代编辑器 | ✅ 已写 |
| STM32CubeIDE        | STM32 一体化 IDE，免费无代码限制         | ✅ 已写 |
| CLion + CubeMX      | 编辑器体验最佳，远程/跨平台开发          | ✅ 已写 |
| VSCode + PlatformIO | **ESP32 / Arduino** / 多平台             | ✅ 已写 |
| VSCode + ESP-IDF    | ESP32 官方框架，深度开发 ESP32           | ✅ 已写 |
| RT-Thread Studio    | 国产 RTOS 生态，RT-Thread 开发           | ✅ 已写 |

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

## 三、Keil C51 / C251（STC / 8051）

C51 和 C251 是 Keil 针对**非 ARM 的 8 位单片机**推出的编译器：

- **C51**：经典 8051 内核，对应 **STC89C52、AT89C51** 等老 8051 单片机
- **C251**：**STC8、STC16、STC32** 等新 STC 系列用（80251 内核）
- **MDK-ARM**：STM32 / GD32 等 **ARM Cortex** 芯片（上文「二」讲的就是它）

三个可以装在同一台电脑共存，共用同一个 uVision 界面，按工程自动选编译器，不用来回切换软件。

!!! tip "先搞清楚你的芯片用哪个编译器"
    建工程时在芯片下拉里能看到，但归类规律是：**STC89/AT89 等经典 8051 → C51**；**STC8/STC16/STC32 → C251**；**STM32 等 ARM → MDK**。选错编译器编译必挂。

### 1. 安装与共存（关键）

C51 / C251 / MDK 共用同一个 **uVision5** 外壳，所以：

1. **三个安装包的主版本号必须都是 uVision5**（如 MDK 5.x、C51 V9.6x、C251 V5.6x）。若混入 uV4 版，整合会失败
2. **顺序**：先装 C51，再装 C251，最后装 MDK。装 MDK 时最后弹「版本替换」对话框，选 **Skip**（不覆盖现有文件）
3. **目录分开**：C51、C251、MDK 分别装到 `Keil\C51`、`Keil\C251`、`Keil\ARM` 等不同文件夹，别覆盖
4. **合并 UV4 目录**：把 C51、C251 里的 `UV4` 文件夹内容复制进 MDK 的 `UV4`，同名文件选 **跳过（Skip）**
5. **合并 TOOLS.INI**：把 C51、C251 的 `TOOLS.INI` 内容追加到 MDK 的 `TOOLS.INI` 末尾，并把复制来的 PATH 改成各自实际目录（如 `PATH=...\Keil\C51`）
6. 打开一次 MDK 的 `UV4.exe`，确认三个编译器都在（`Project → Manage → Project Items` 或建工程看芯片下拉）

!!! warning "许可证（License）"
    C51、C251、MDK **各自注册，共用一个 CID**。打开 `UV4.exe → File → License Management`，复制 CID，用破解工具分别按 **C51 / C251 / ARM** 三个 Target 各生成一条 License，全部 Add 进去。只注册一个的话，换芯片类型编译会报 License 错误。

### 2. 给 STC 芯片加支持

Keil 本身不认识 STC，需要 STC 官方烧录软件 **STC-ISP** 把 STC 芯片加进 Keil：

1. 下载运行 **STC-ISP**（STC 官网获取）
2. 找到 **Keil 仿真设置 / 添加型号到 Keil** 功能
3. 选择 Keil 安装目录，**C51、C251 各添加一次**（保险起见）
4. 添加完成后，Keil 建工程时芯片下拉里就能看到 STC 系列（如 STC32G）

### 3. 使用

- **建工程**：`Project → New μVision Project`，芯片选择界面的**下拉框**里选对应工具链（C51 / C251 / ARM），再选芯片
- **编译**：`F7`
- **烧录**：C51/C251 芯片**一般不用 Keil 烧录**，用 **STC-ISP** 烧（选串口 COM、点下载、给板上电）；MDK 的烧录见上文「二」
- **调试**：STC 芯片用 Keil 内仿真器或 STC-ISP，注意老 8051 的仿真支持有限

### 4. 避坑备忘

- **混装 uV4/uV5**：整合必失败，三个包统一用 uVision5 版本
- **只注册一个 License**：换工具链编译报错，三个 Target 都要注册
- **STC 芯片没出现在下拉**：STC-ISP 没添加成功，重添加
- **选错编译器**：STC32 用 C51 编译必挂，先确认芯片属哪个内核

---

## 四、VSCode + EIDE（打开 Keil 工程）

Keil 的编辑器太老，用 [EIDE](https://em-ide.com)（Embedded IDE）插件把 Keil 工程搬进 VSCode，享受现代编辑器体验。**前提：Keil5 已装好**（编译仍靠 Keil 的编译器，EIDE 只负责调用）。

### 1. 安装 VSCode 与插件

1. 安装 [VSCode](https://code.visualstudio.com/)（建议 System 版，避免权限问题）
2. 扩展商店 `Ctrl+Shift+X`，安装：
   - **Embedded IDE（EIDE）** —— 核心
   - **C/C++** —— 代码提示
   - **Cortex-Debug** —— 调试（可选）
   - **Serial Monitor** —— 串口查看（可选）
3. EIDE 若提示需要 **.NET 6 运行时**，按其指引安装（失败则手动下载 [.NET 6 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/6.0)）

### 2. 配置 EIDE 工具链路径

VSCode 左侧活动栏 → **EIDE 图标** → **设置（齿轮）** → 工具链配置，指向 Keil 安装目录：

| 设置项            | 指向                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| **ARMCC 路径**    | Keil5 安装目录下的 `ARMCC/` 文件夹（如 `C:\Keil_v5\ARM\ARMCC`）       |
| **ARMCLANG 路径** | Keil5 安装目录下的 `ARMCLANG/` 文件夹（如 `C:\Keil_v5\ARM\ARMCLANG`） |
| **UV4 路径**      | Keil5 安装目录下的 `UV4.exe`（如 `C:\Keil_v5\UV4\UV4.exe`）           |

!!! tip "路径分隔符"
    EIDE 的 `setting.json` 里路径统一用 `/`，不要用 `\`（会被当成转义符）。`C:\Keil_v5` 写作 `C:/Keil_v5`。

### 3. 导入 Keil 工程

1. EIDE 面板 → **导入 Keil_v5 工程（.uvprojx）** → 选择 `.uvprojx`
2. 弹窗问是否和 Keil 文件同路径时选 **NO**，单独放一个英文路径的文件夹（比如 `EIDE/`），避免干扰原 Keil 工程
3. 导入后右键工程 → **打开工程目录** 把文件夹加入工作区（或在 VSCode 中 `File → Open Folder` 打开它）

### 4. 编译与烧录

- **编译**：EIDE 面板点**构建**按钮（相当于 Keil 的魔法棒），或 `Ctrl+Shift+B`
- **烧录**：EIDE 面板 → **烧录配置**：
  - 下拉选 **ST-Link**（或用 **OpenOCD**，接口配置 `stlink.cfg`）
  - 选好后点**下载/烧录**按钮
- 若缺少 ARMCC 报错，重装对应芯片的 Keil DFP 包（见上文 Keil 一节）

### 5. 避坑备忘

- **头文件找不到（红色波浪线）**：工程没认到包含目录 → EIDE 项目属性 → **包含目录** 里手动添加路径
- **宏定义缺失报错**：项目属性里加上 `USE_HAL_DRIVER` 和芯片型号（如 `STM32F103xE`），HAL 工程必需
- **乱码**：EIDE 与 Keil 文件编码不一致时不要直接保存，先统一编码（Keil 一侧设 UTF-8，见上文）
- **别用 EIDE 覆盖原 Keil 工程**：导入时分开目录存放，CubeMX 重新生成仍用 Keil 流程，两边互不干扰

---

## 五、STM32CubeIDE

ST 官方的**一体化** IDE：集成 CubeMX 配置、代码生成、编译、调试、下载，**免费且无代码量限制**（对比 Keil 评估版 32KB）。适合不想折腾 License、想一个软件搞定全部流程的人。

### 1. 安装

1. 到 ST 官网下载：[STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html)（需注册 ST 账号）
2. 安装包较大（约 1GB+），一路下一步。**建议不要装在 C 盘**（默认 `C:\ST\STM32CubeIDE_1.x.x`，IDE + 固件包 + 工作区都占空间）
3. 首次打开会引导设置**工作区（Workspace）**路径，放非 C 盘，如 `D:\CubeIDE_Workspace`
4. 首次建工程时会下载对应芯片的固件包（STM32CubeF1/F4 等），几百 MB；也可 `Help → Manage embedded software packages` 提前下载

### 2. 新建工程（点灯为例）

1. `File → New → STM32 Project` → 在 **MCU Selector** 里搜索选型（如 `STM32F103C8T6`）
2. **System Core → RCC → HSE**：板上有外部晶振选 `Crystal/Ceramic Resonator`，否则保持 `Disable`
3. **Clock Configuration**：把 `HCLK` 设为目标频率（如 F103 拉满 72MHz）
4. 配置外设：如把 `PA5` 设为 `GPIO_Output`
5. 右侧 **Project Manager** 页：
   - 工程名和**存放路径不能含中文**
   - `Toolchain` 保持默认的 **STM32CubeIDE**（即 GCC）
   - 建议勾选 `Generate peripheral initialization as a pair of '.c/.h' files per peripheral`，外设各自独立文件，工程不混乱
6. 点右上角 **GENERATE CODE**，完成后自动进入 IDE 工程

!!! tip "和 CubeMX 的关系"
    CubeIDE 内置了 CubeMX 的全部配置功能（同一个 `.ioc` 文件）。装 CubeIDE 就不需要另装 CubeMX。双击 `.ioc` 文件即进入图形配置界面，改动后**必须生成代码**才生效。

### 3. 编译、下载、调试

1. **编译**：`Project → Build Project`，或工具栏锤子按钮；输出看底部 **Console** 窗口
2. **下载**：点工具栏 **Run**（绿色播放键），或 `Run → Run`
3. **调试**：点工具栏 **Debug**（绿色虫子图标），或 `Run → Debug`
4. 首次会弹 **Debug Configuration**：
   - 调试器下拉选 **ST-LINK（ST-LINK GDB Server）**（或 **J-Link** / **ST-LINK（OpenOCD）**）
   - `Flash Download` 确认 Flash 算法正确（一般已带）
   - 点 **Debug** 进入断点调试，可单步、看变量、看外设寄存器
5. 若 `Run` 提示找不到调试器：板子接上 SWD 四根线（SWDIO / SWCLK / GND / 3V3），确认 ST-Link 驱动正常

### 4. 避坑备忘

- **中文路径**：工程、工作区、安装路径含中文会出诡异问题，一律用英文路径
- **工程体积大**：CubeIDE 的工程自带完整固件副本，比 Keil 工程占空间，正常现象
- **改的代码被覆盖**：CubeMX 重新生成会覆盖 `.c/.h`，自己的代码写在 `/* USER CODE BEGIN/END */` 区块里
- **标准库用户**：CubeIDE 默认生成 HAL 库；想用标准库需手动移植，新项目建议直接用 HAL/LL

---

## 六、CLion + CubeMX

JetBrains 出品的 C/C++ IDE，**编辑器体验最佳**（补全、重构、VCS 一流），配合 CubeMX 生成工程、OpenOCD 下载调试。偏付费软件（CLion 收费，学生可免费申请），因为是商用付费的，适合自己玩的时候使用，如果有老板不介意的话也可以花钱换体验。

### 1. 安装工具链

| 工具                  | 说明                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **CLion**             | 官网下载，安装即可                                                                                                 |
| **STM32CubeMX**       | 见上文 Keil 一节（CLion 依赖它生成工程）                                                                           |
| **arm-none-eabi-gcc** | GNU ARM 交叉编译器，需加入系统 `PATH`，命令行 `arm-none-eabi-gcc --version` 能输出版本即成功                       |
| **OpenOCD**           | 下载调试代理，从 [openocd.org](https://openocd.org/pages/getting-openocd.html) 获取 Windows 版，解压后配置到 CLion |

!!! tip "Windows 装 arm-none-eabi-gcc"
    推荐从 ARM 官网下载（<https://developer.arm.com/downloads/-/arm-gnu-toolchain-downloads>），装完把 `...\bin` 目录加进**系统 PATH 环境变量**，并重开 CLion 让它读到。

### 2. 配置 Embedded Development

`File → Settings → Build, Execution, Deployment → Embedded Development`：

- **CubeMX Location**：填 CubeMX 安装路径
- **OpenOCD Location**：填 OpenOCD 解压目录（用 ST-Link + OpenOCD 调试时需要）
- 若只编译下载不用 OpenOCD，OpenOCD 字段可留空

### 3. 新建工程（点灯为例）

1. `File → New Project` → 选 **STM32CubeMX** 项目类型
2. 点击链接 **Open with STM32CubeMX**，在 CubeMX 里选型（如 `STM32F103C8T6`）
3. 配置外设：`PA5` 设 `GPIO_Output`；`System Core → RCC → HSE` 按板子选外部晶振或 `Disable`
4. **Clock Configuration**：`HCLK` 设 72MHz
5. **Project Manager**：`Toolchain / IDE` 选 **STM32CubeIDE**，勾上 **Generate Under Root**，点 **GENERATE CODE**
   - 工程名、路径**不能含中文**；`.ioc` 文件名同样不能含空格和非拉丁字符
6. 回到 CLion，CMake 加载完成后会弹 **board config 选择**：从 OpenOCD 的 `board/` 目录选对应板子的配置（如 STM32F103 板选 `st_nucleo_f103rb.cfg`）→ **Copy to Project & Use**
   - 这些 board 配置已内置 ST-Link 接口和 SWD 设置，一般**不用手动配 interface 文件**

!!! tip "已有工程怎么打开"
    `File → Open` 直接选 `.ioc` 文件 → 选 **Open as Project**，CLion 会自动生成 CMake 工程，原理同新建。

### 4. 编译、下载、调试

1. **编译**：点右上角**锤子**按钮，或 `Build → Build Project`
2. **下载/调试**：右上角运行配置下拉 → **Edit Configurations**：
   - 类型选 **OpenOCD Download & Run**
   - **Board config file** 确认指向之前选的 `st_nucleo_f103rb.cfg`（可在下拉里换）
   - 点 **运行**（绿色播放）下载并运行，或点 **Debug** 进入断点调试
3. 若用其他下载器：换用 J-Link / ST-Link 的 GDB Server 类型配置（`Embedded GDB Server`），字段大同小异

### 5. 避坑备忘

- **CMakeLists.txt 被覆盖**：CubeMX 重新生成会重写 CMakeLists.txt，要改构建脚本（加库、开 FPU）编辑 **`CMakeLists_template.txt`** 而不是 CMakeLists.txt
- **改的代码被覆盖**：代码写在 `/* USER CODE BEGIN/END */` 区块里；新增文件放 `Src/` 和 `Inc/` 目录
- **重新生成后 CLion 不刷新**：右键 `.ioc` → **Update CMake project with STM32CubeMX** 手动同步
- **不支持芯片**：STM32MP1、STM32H7 双核、开 TrustZone 的 STM32L5 不受支持，会建不了工程
- **编译报工具链找不到**：`arm-none-eabi-gcc` 没进 PATH 或没重开 CLion，重配后重启 IDE

!!! tip "一个很赞的点：新增文件自动加进 CMake"
    手动新建的 `.c/.h` 文件如果没有被 CMake 收录，CLion 工程树里会有 **提示标记**，点一下就能**自动把它加进 CMakeLists.txt**，不用手动改构建脚本。写代码时随手新建的文件，编译前点掉提示就不会漏编译。

---

## 七、VSCode + PlatformIO（ESP32 为主）

PlatformIO 是单片机开发的包管理器 + 构建系统，**支持大量平台**（ESP32、Arduino、STM32 等），在 VSCode 里一套搞定编译、烧录、串口监控。我这里主要是拿它来开发 **ESP32**。

### 1. 安装

1. 安装 [VSCode](https://code.visualstudio.com/)
2. 扩展商店 `Ctrl+Shift+X`，搜索安装 **PlatformIO IDE**（同名扩展，安装量大、耗时较久，属正常）
3. 左侧活动栏会出现 **蚂蚁图标**（PlatformIO 入口）

!!! warning "千万别开自动更新（无梯子）"
    PlatformIO 的自动更新 / 首次下载平台和工具链要访问国外服务器，**没有梯子会非常慢甚至卡死**（亲身经历）。建议：
    - 安装完在 VSCode 设置里关掉 PlatformIO 的自动更新
    - 首次建工程下载 ESP32 工具链（xtensa 编译器、ESP-IDF 等）会花较长时间，**耐心等待，别中途关**
    - 有梯子则全程无忧

### 2. 新建 ESP32 工程

1. 蚂蚁图标 → **PIO Home** → **New Project**
2. 填工程名（路径**不能含中文**），**Board** 选你的板子：
   - 通用 ESP32 开发板选 **`esp32-devkit-v1`**（或其对应型号）
   - 找不到就选相近的，只要能对应芯片型号即可
3. **Framework** 选 **Arduino**（最省事）或 **ESP-IDF**（功能全、更底层，配置复杂）
4. 点 **Finish**，等待首次下载 ESP32 工具链完成（见上方警告，会比较久）

### 3. 编译、烧录、串口监控

- **编译**：底部状态栏 PlatformIO 图标 → **Build**，或项目里的 `Upload` 前自动构建
- **烧录**：**Upload**（上传），连好 USB 线，板子在 `Device Manager` 里能看到 COM 口
- **串口监控**：**Serial Monitor**，选对 COM 口和波特率（如 115200），就能看到 `Serial.println` 的输出
- 常用快捷键：`Ctrl+Alt+B`（Build）、`Ctrl+Alt+U`（Upload）、`Ctrl+Alt+S`（Serial Monitor）

### 4. 常用配置（platformio.ini）

每个工程根目录都有 `platformio.ini`，常用配置示例：

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200      ; 串口监视器波特率
upload_speed = 921600       ; 烧录波特率（快）
```

- 改配置保存后，PlatformIO 会自动重新加载环境
- 加库（如 WiFi 相关库）在 `lib_deps` 里声明，会自动下载

### 5. 避坑备忘

- **路径别含中文**：工程路径含中文会编译报错
- **首次下载慢**：见上文警告，关自动更新 + 耐心等；实在慢可尝试换 `platformio.ini` 里的国内镜像源
- **烧录失败 / 连接不上**：换根 USB 线（很多数据线只有供电没有数据）、确认选了正确的 COM 口、必要时按住板子 **BOOT 键**再点 Upload
- **USB 驱动**：某些 ESP32 板用 CH340/CP2102 芯片，Windows 需装对应驱动，装完才认到 COM 口

---

## 八、VSCode + ESP-IDF

ESP-IDF 是 **ESP32 的官方开发框架**，乐鑫原生支持、功能最全（WiFi/BLE/RTOS 都由官方维护）。在 VSCode 里用官方 ESP-IDF 扩展，比 PlatformIO 更贴近官方生态。主要用于深度开发 ESP32，不用 Arduino 那层封装时选它。

!!! warning "配置界面是全英文，改前先读注释"
    扩展的配置项在 VSCode 设置里都以 **`idf.` 开头**（如 `idf.espIdfPath`、`idf.port`），**界面纯英文**，每个设置项下面有英文说明文字。修改路径类配置时**务必先读清楚注释再改**，比如 `idf.espIdfPathWin` 要填 ESP-IDF 源码目录、`idf.portWin` 填串口号（COMx），填错或填错位置会连不上、编译不了，而且这种错误不明显、很难查。

### 1. 安装与配置（首次）

1. 扩展商店 `Ctrl+Shift+X`，搜索安装 **ESP-IDF**（Espressif 官方出品）
2. 首次使用会弹 **配置向导**，或 `Ctrl+Shift+P` 输入 **`ESP-IDF: Configure ESP-IDF extension`** 打开
3. 向导分三种模式：
   - **Express install（快速安装）**：选一个 ESP-IDF 版本（下载或找已有），自动装工具链 + 建 Python 虚拟环境。**新手选这个最省事**
   - **Advanced install（高级安装）**：手动指定每个工具的目录，懂行的才选
   - **Use existing setup（使用现有配置）**：机器上已有 ESP-IDF 环境时直接引用
4. 首次配置会下载工具链（xtensa 编译器、cmake、ninja 等），**体积较大，等它装完别中断**

!!! tip "路径三注意"
    - **不能有空格、不能有中文**（ESP-IDF 构建系统还不支持带空格路径）
    - 别在配置里写 `~`、`$HOME`、`%USERPROFILE%` 这类变量，不会被解析，要写绝对路径
    - 装完可用 **`ESP-IDF: Doctor Command`** 一键检查配置是否正常

### 2. 新建与使用

1. **新建工程**：`Ctrl+Shift+P` → **`ESP-IDF: Create New Project`**，选模板（如 `hello_world`）、填工程名、选目标芯片（esp32/esp32s3 等）
2. **编译**：**`ESP-IDF: Build Project`**（或状态栏火苗图标）

!!! warning "编译巨慢，点完就可以去刷抖音了"
    ESP-IDF 编译**非常慢，尤其是改完代码增量编译**（第一次全量编译更是十几分钟起步，可能是我的电脑垃圾）。而且编译时 CPU 会被吃满，**整台电脑都会卡**，点下编译后该干嘛干嘛去，别干等。想快点：
    - 只改动一个文件时，编译目标是 **`build/app`**（或组件对应目标），比全量快很多
    - 关掉不相关的 IDE 窗口/浏览器，给编译腾 CPU
3. **烧录**：**`ESP-IDF: Flash your project`**，会先自动编译；选对串口（`idf.port`）
4. **串口监控**：**`ESP-IDF: Serial Monitor`**，看 `ESP_LOGI` 等日志输出
5. **SDK 配置**：**`ESP-IDF: SDK Configuration Editor`** 打开图形化配置界面（等价于 `menuconfig`），改 WiFi、Flash、分区等
6. **切换版本**：装了多个 IDF 版本时用 **`ESP-IDF: Select Current ESP-IDF Version`** 切换

### 3. 避坑备忘

- **路径带空格/中文**：编译报一堆奇怪错误，工程和 IDF 目录都别放这类路径
- **串口占满**：Serial Monitor 开着时烧录会失败，先关闭监控再 Flash
- **配置项别乱改**：`idf.*` 设置项全英文，尤其路径类，改前读注释（见上文警告）
- **首次装慢**：工具链下载较大，换个网络/梯子或耐心等，别装一半杀进程，装坏了要删干净重来

---

## 九、RT-Thread Studio

RT-Thread 是**国产开源 RTOS**，中文文档完善、社区活跃。RT-Thread Studio 是它的官方 IDE，一体化搞定建工程、编译、下载、调试，还能图形化配置 RT-Thread 组件和在线软件包。适合要用 **RT-Thread 做项目**（而不是裸机）的人。

### 1. 安装

1. 到 RT-Thread 官网下载 [RT-Thread Studio](https://www.rt-thread.org/)，安装包较大
2. 一路下一步，安装时自动创建 **workspace** 目录（工程默认存放处，建议放非 C 盘）
3. 首次使用需**注册 RT-Thread 账号**登录，才能用完整功能（组件配置、软件包下载等）
4. 建 STM32 工程依赖 **STM32CubeMX**（生成外设初始化）和对应 **HAL 库**，机器上装好 CubeMX

### 2. 新建工程（STM32 为例）

`文件 → 新建 → RT-Thread 项目`：

1. 填工程名、选存储位置（建议自定义英文目录）
2. 创建方式选 **基于芯片**
3. 选主控型号（如 `STM32F103C8T6`）
4. 配置**控制台串口**（调试日志默认走串口，常选 UART1）
5. 选**调试接口**（ST-Link / J-Link 等）
6. 选 RT-Thread 版本，点 **完成**

!!! tip "版本选择"
    RT-Thread 分 **标准版**（完整 RTOS，组件全）和 **Nano 版**（精简内核，适合资源紧张）。新手用标准版即可，Nano 精简版需要时再切。

### 3. 编译、下载、调试

- **编译**：顶部工具栏**编译**按钮（或 `Ctrl+B`）
- **下载**：**下载**按钮，先确认调试接口和串口配置正确
- **调试**：**调试**按钮进入断点调试（ST-Link / J-Link 都支持）
- **看日志**：底部 **终端/串口** 视图，对应控制台串口看 `rt_kprintf` 输出

### 4. 组件配置与软件包

RT-Thread 的特色是**在线软件包**——在 `RT-Thread Settings` 界面（工程根目录双击打开）勾选组件（Shell/FinSH、设备驱动、网络、LVGL 等），点**保存/同步**，Studio 自动下载源码并加入构建，比手写 Makefile 省心得多。

- 类似 `menuconfig` 的图形化配置，中文界面
- 配置后**必须重新编译**才生效

### 5. 避坑备忘

- **版本别用太新**：新版本偶有建工程编译报错，遇到可退回稳定版（社区常反馈）
- **依赖 CubeMX**：改引脚/时钟等外设，用 CubeMX 改完回到 Studio 同步（和 CLion 类似，见上文 CLion 一节）
- **账号登录**：不登录有些功能/软件包下不了，注册是免费的
- **中文路径**：工程路径含中文会编译异常，一律用英文路径

---

## 十、其他环境（规划中）

- 暂无

---
