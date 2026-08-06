# STM32 RTC：从走时到一堆「隐藏功能」的一篇讲透

> 一句话：**RTC（Real-Time Clock）是芯片里那只断电也能走的表**——靠独立电池域供电 + 外部 32.768kHz 晶振，掉电、复位、进低功耗都不影响它计数。要讲清楚的其实也是三件事——**它靠什么时钟走（LSE/LSI/HSE÷128）**、**怎么把时间写进去读出来（F1 计数器式 vs F4 日历式，两代差异巨大）**、**除了走时它还能干什么（闹钟、定时唤醒、时间戳、入侵检测、校准）**。本文以 F1/F4 的 RTC 为主，寄存器名与配置以 HAL 为准，时钟源背景见 [stm32-clock-tree.md](stm32-clock-tree.md)。

## 一、RTC 是什么、长什么样

RTC 的本质是**一个带独立电源的计数器/日历**。它挂在备份域（Backup Domain）里，和主电源 VDD 分开：

```text
VBAT（纽扣电池/电容） ──┐
                        ├─→ 备份域（LSE 晶振 + RTC + 备份寄存器 BKP）
VDD（主电源）        ──┘
```

- VDD 在，就用 VDD 供电；VDD 掉电、复位、进 STANDBY，自动切到 VBAT，RTC 继续走
- **NRST 复位、软件复位都碰不到备份域**，RTC 时间不丢
- 三个时钟源可选：**LSE（外部 32.768kHz 晶振，首选）、LSI（内部 RC ~32kHz）、HSE÷128**

F1 与 F4 的 RTC 是**两代完全不同的设计**，别拿 F1 的用法套 F4，这是全文最重要的前提。

## 二、一代 vs 二代：F1 计数器式 RTC 与 F4 日历式 RTC

| | F1（F103） | F4（F407） |
| -- | ---------- | ---------- |
| 本质 | **32 位秒计数器**（RTC_CNT）+ 预分频器 | **日历寄存器**（年/月/日/时/分/秒/星期，BCD 存储） |
| 日期 | **没有日期寄存器**，日期自己算/自己存 | 寄存器直接存年月日星期 |
| 预分频 | 1 个（RTC_PRL，配 32767 → 1Hz） | 两个（PREDIV_A 异步 + PREDIV_S 同步，还能读亚秒 SSR） |
| 闹钟 | 1 个，比较完整秒计数（RTC_ALR） | 2 个（闹钟 A/B），每字段可加掩码 |
| 自动唤醒定时器 WUT | **没有** | 有（独立低功耗唤醒） |
| 时间戳 / 亚秒 | 没有（只有 RTC_DIV 余数） | 有（时间戳 + 24 位亚秒） |
| 入侵检测 Tamper | 有（TAMPER 引脚清 BKP） | 有（TAMP1/TAMP2，清 BKP + 时间戳） |
| 数字校准 | **没有**，只能软件校 | 有 Smooth 数字校准（±~487 ppm）+ 参考时钟检测 |
| 备份寄存器 | BKP：42 个 16 位 | RTC_BKP0R~19R：20 个 32 位 |
| 影子寄存器 | 没有 | 有（读时间可能读到进位中的值，BYPSHAD 可关） |
| HAL 差异 | HAL_RTC 只处理时/分/秒 | HAL_RTC 完整处理日历 |

!!! warning "F1 闹钟是一次性的，F4 才是"每天循环""
    F1 的闹钟是比较 `RTC_CNT == RTC_ALR` 这个**绝对秒时刻**，响一次就完，下次要自己重新写 ALR。F4 的闹钟带掩码，可以精确到"每天/每周几的几点几分"重复触发。抄代码前先分清是哪一代。

## 三、时钟源与备份域（先选好时钟，后面才走得准）

RTC 的精度上限 = 时钟源的精度。三个源，三个性格：

| 时钟源 | 频率 | 精度 | 掉电（VBAT）后 | 功耗 | 适用 |
| ------ | ---- | ---- | ------------ | ---- | ---- |
| **LSE** | 32.768kHz | 高（晶振，±20ppm 级） | **继续走** | 极低 | 绝大多数场景，首选 |
| **LSI** | ~32kHz | 低（内部 RC，±几十 % 量级） | **停走！** | 低 | 省晶振/省引脚，且**不在乎断电** |
| **HSE÷128** | 8MHz÷128=62.5kHz | 高 | **停走！**（HSE 随主电源关） | 高 | 想用系统时钟精度又不想加晶振 |

!!! warning "LSI / HSE÷128 掉电就走不动"
    这两个源挂在主电源域，VDD 一掉 RTC 就停。只有 **LSE 在备份域**，靠 VBAT 掉电后还能走。想"断电后时间还在"，必须 LSE；用 LSI 的 RTC 断电后重新对时即可。

关键配置点（F4，CubeMX 在时钟树里把 `RTC Clock Source` 选 `LSE`）：

- 使能 LSE 后要**等 `LSERDY` 置位**再操作 RTC——外部晶振起振要几百 ms 到 1s，别一使能就初始化
- CubeMX 的 `Activate Clock Source` + 在 `RTC` 页勾 `Activate` 即可，HAL 的 `HAL_RTC_MspInit` 会生成 `RCC_OscConfig` 配 LSE
- 备份域寄存器有**写保护**：先 `HAL_PWR_EnableBkUpAccess()`（置 PWR_CR.DBP），RTC 寄存器才能写——CubeMX 生成的代码已经带了

F4 的预分频为什么是两个：`PREDIV_A`（异步 7 位）+ `PREDIV_S`（同步 15 位）把 LSE 降到 1Hz 秒脉冲，同时留出亚秒读数（见第九节）。典型 LSE 32.768kHz 配 `PREDIV_A=127, PREDIV_S=255`：

```text
32768 / (128 × 256) = 1 Hz    ← 秒脉冲
```

## 四、配置说明（CubeMX + HAL 最小步骤）

### F4：日历式，直接读写年月日

CubeMX：`RTC` → 勾 `Activate`，`Parameters` 页设 `Hour Format`、`AsynchPrediv=127`、`SynchPrediv=255`，`Day/Date/Time` 填初始时间 → 生成。

```c
/* ===== 写时间（CubeMX 只在首次启动时执行一次，见下文"初始化判断"） ===== */
RTC_TimeTypeDef sTime = {0};
sTime.Hours      = 10;
sTime.Minutes    = 30;
sTime.Seconds    = 0;
sTime.DayLightSaving = RTC_DAYLIGHTSAVING_NONE;
sTime.StoreOperation = RTC_STOREOPERATION_RESET;
HAL_RTC_SetTime(&hrtc, &sTime, RTC_FORMAT_BIN);

RTC_DateTypeDef sDate = {0};
sDate.Year      = 25;            /* 存的是"2000 偏移"，25 = 2025 年 */
sDate.Month     = RTC_MONTH_AUGUST;
sDate.Date      = 6;
sDate.WeekDay   = RTC_WEEKDAY_THURSDAY;
HAL_RTC_SetDate(&hrtc, &sDate, RTC_FORMAT_BIN);
```

```c
/* ===== 读时间（注意顺序：先 GetTime 再 GetDate） ===== */
RTC_TimeTypeDef sTime;
RTC_DateTypeDef sDate;
HAL_RTC_GetTime(&hrtc, &sTime, RTC_FORMAT_BIN);
HAL_RTC_GetDate(&hrtc, &sDate, RTC_FORMAT_BIN);
printf("%04d-%02d-%02d %02d:%02d:%02d\n",
       2000 + sDate.Year, sDate.Month, sDate.Date,
       sTime.Hours, sTime.Minutes, sTime.Seconds);
```

要点：

- `RTC_FORMAT_BIN` 让 HAL 帮你做 BCD↔二进制换算，别自己在应用层折腾 BCD
- **Year 是 2000 偏移**，打印时记得 +2000
- **读时间顺序固定：先 time 后 date**——HAL 内部靠这个顺序保证两个寄存器读到同一个"瞬间"，反了可能读到跨秒的错值

### F1：计数器式，只有时分秒

CubeMX 在 `RTC` 页配置后，HAL 把时/分/秒换算成秒计数写进 `RTC_CNT`，接口和 F4 表面一样，但**没有日期**：

```c
RTC_TimeTypeDef sTime = {0};
sTime.Hours = 10; sTime.Minutes = 30; sTime.Seconds = 0;
HAL_RTC_SetTime(&hrtc, &sTime, RTC_FORMAT_BIN);

HAL_RTC_GetTime(&hrtc, &sTime, RTC_FORMAT_BIN);   /* 读回时/分/秒 */
```

F1 要带日期，两条路：读 `RTC_CNT` 自己算（1970 年起始秒），或存进 **BKP 备份寄存器**（见第十节）。HAL 层没有对应的日期接口，别硬找。

### 首次初始化判断（F1/F4 都适用，最容易翻车的一步）

RTC 掉电后**仍在走、且不会被任何复位清掉**。如果每次上电都执行"写初始时间"，等于把时间重置回出厂——这是 RTC 应用最高频的 bug。正确姿势：用一个备份寄存器当"已初始化"标志：

```c
/* 读 BKP 标志：不是魔数 → 说明第一次上电，才写时间 */
if (HAL_RTCEx_BKUPRead(&hrtc, RTC_BKP_DR0) != 0x32F2) {
    HAL_RTC_SetTime(&hrtc, &sTime, RTC_FORMAT_BIN);
    HAL_RTC_SetDate(&hrtc, &sDate, RTC_FORMAT_BIN);
    HAL_RTCEx_BKUPWrite(&hrtc, RTC_BKP_DR0, 0x32F2);   /* F1 用 HAL_RTCEx_BKUPWrite 同理 */
}
```

- 0x32F2 只是约定俗成的魔数，换成你喜欢的 16 位值即可
- F1 的备份寄存器接口在 `stm32f1xx_hal_rtc_ex.c`，名字相同

## 五、闹钟：日常提醒与低功耗唤醒

### F4：两路闹钟 A/B，掩码是精华

闹钟的核心是**掩码（Mask）**——哪几位要参与比较。掩码掉（忽略）某个字段，就能做成"每小时""每天""每周几"循环：

```c
RTC_AlarmTypeDef sAlarm = {0};

/* 每日 07:00:00 响：掩码掉日期/星期，只比时分秒 */
sAlarm.AlarmTime.Hours   = 7;
sAlarm.AlarmTime.Minutes = 0;
sAlarm.AlarmTime.Seconds = 0;
sAlarm.AlarmDateWeekDaySel = RTC_ALARMDATEWEEKDAYSEL_DATE;   /* 用日期还是星期 */
sAlarm.AlarmDateWeekDay    = 1;
sAlarm.AlarmMask = RTC_ALARMMASK_DATEWEEKDAY;    /* 忽略星期/日期 → 每天 7 点 */

HAL_RTC_SetAlarm_IT(&hrtc, &sAlarm, RTC_FORMAT_BIN);
```

| AlarmMask 取值 | 比较什么 | 触发节奏 |
| -------------- | -------- | -------- |
| `RTC_ALARMMASK_NONE` | 全字段 | 精确到秒，一次性（或到那个日期那一次） |
| `RTC_ALARMMASK_DATEWEEKDAY` | 只比时分秒 | **每天**该时刻 |
| `RTC_ALARMMASK_HOURS`（再掩掉分秒） | 只比小时 | **每小时** |
| `RTC_ALARMMASK_ALL` | 什么都不比 | 立即触发（调试用） |

```c
/* 中断回调：闹钟 A 匹配 */
void HAL_RTC_AlarmAEventCallback(RTC_HandleTypeDef* hrtc) {
    /* 做该做的事；想清标志 HAL_RTCEx_AlarmIRQHandler 已处理 */
}
```

- 中断处理走 `HAL_RTCEx_AlarmIRQHandler(&hrtc)`，由它分发到上面的回调
- 闹钟事件能**唤醒 STOP / STANDBY 模式**（F4 映射到 EXTI 线 25），这是低功耗下"定时醒来干活"的标配手段
- 两路闹钟 A/B 独立配置，可一个做每日整点报时、一个做定时任务

### F1：一个绝对时刻，响一次

F1 闹钟比较 `RTC_CNT == RTC_ALR`。要每天 7 点响：算出明天 7 点对应的秒数写进 ALR，响完**必须再写下一次**，否则再也不响。想循环只能靠中断里自己续写，或者干脆用秒中断自己计数。

## 六、（F4 隐藏功能）自动唤醒定时器 WUT

WUT 是 RTC 里**独立于闹钟**的一只小闹表：它只做一件事——周期性地把系统从低功耗唤醒，不占闹钟 A/B，也不用软件续期。

```c
/* 每 30 秒唤醒一次，然后自动重装、继续数 */
HAL_RTCEx_SetWakeUpTimer_IT(&hrtc, 30, RTC_WAKEUPCLOCK_CK_SPRE_1HZ);
```

- 时钟源 `RTC_WAKEUPCLOCK_CK_SPRE_1HZ` 下，第二个参数**直接就是秒数**；换成 `CK_SPRE_16HZ`/`CK_SPRE_8HZ`/`CK_SPRE_2HZ`/`CK_APRE` 可更精细
- 唤醒周期公式：`(WUTR + 1) × 时钟周期`，WUT 是 16 位 → 1Hz 下最长约 **18 小时 12 分**
- 回调：`HAL_RTCEx_WakeUpTimerEventCallback`，中断处理走 `HAL_RTCEx_WakeUpTimerIRQHandler(&hrtc)`
- **和闹钟的区别**：闹钟是"定点响"（某时刻），WUT 是"定周期响"（每 N 秒）。做固定节拍的轮询、传感器周期采样，WUT 更省事；要精确到某个时刻用闹钟

## 七、（F4 隐藏功能）时间戳与 Tamper 入侵检测

### 时间戳：记录"那一刻"是哪一秒

把 RTC 当"事件发生时间"的记录仪——事件一来，RTC 把当前时刻快照进时间戳寄存器，CPU 事后慢慢读：

```c
HAL_RTCEx_SetTimeStamp_IT(&hrtc, RTC_TIMESTAMPEDGE_RISING);   /* 上升沿触发 */

/* 事件发生后读快照 */
RTC_TimeStampTypeDef sTS;
HAL_RTCEx_GetTimeStamp(&hrtc, &sTS, RTC_FORMAT_BIN);
```

- 中断处理走 `HAL_RTCEx_TamperTimeStampIRQHandler`，回调是 `HAL_RTCEx_TamperTimeStampEventCallback`
- 用途：掉电瞬间记录最后时刻、外部关键事件打点、防作弊的时间证据

### Tamper：撬机即清数据（安全功能）

Tamper 是给"怕被人拆"的产品准备的：检测到入侵引脚电平变化 → **立即清空备份域数据**（BKP 寄存器 + 时间戳），防止拆机后改数据/篡改时间。

```c
RTC_TamperTypeDef sTamp = {0};
sTamp.Tamper  = RTC_TAMPER_1;
sTamp.Trigger = RTC_TAMPERTRIGGER_RISINGEDGE;   /* 选边沿方向 */
sTamp.Filter  = RTC_TAMPERFILTER_DISABLE;       /* 可加滤波防误触 */
HAL_RTCEx_SetTamper_IT(&hrtc, &sTamp);
```

!!! warning "Tamper 触发后数据被清，记得重初始化"
    Tamper 一旦触发，备份域数据就没了——应用里要重新写 RTC 时间和初始化标志（回到第四节那套），并记一次"被入侵过"。引脚默认 `TAMP_IN`（F4 与 PC13 复用，注意别和 RTC 输出功能打架）。

F1 也有类似的 TAMPER 引脚，触发后清 BKP 寄存器，机制一样，寄存器在备份域章节（BKP_CR 的 TPE/TPAL）。

## 八、（F4 隐藏功能）校准：Smooth 数字校准 + 参考时钟检测

任何晶振都会漂，RTC 走快/走慢是常态。F4 内置了两种校准手段，F1 只能软件校。

### Smooth 数字校准

在硬件层面微调秒脉冲，精度到 **0.95 ppm/步**，不用换晶振。用法：先实测走时偏差（比如对时一周慢了多少秒），换算成 ppm，再写校准：

```c
/* 假设实测 RTC 快了约 20 ppm → 用 CALM 减（每步约 0.95 ppm） */
HAL_RTCEx_SetSmoothCalib(&hrtc,
                         RTC_SMOOTHCALIB_PLUSPULSES_RESET,   /* CALP=0：不加脉冲 */
                         21,                                  /* CALM=21 ≈ 20 ppm */
                         RTC_SMOOTHCALIB_PERIOD_32SEC);      /* 校准窗口 32s */
```

- 校准窗口默认 32 秒（可选 8/16 秒），`CALM` 12 位减脉冲 + `CALP` 加脉冲，范围约 **±487 ppm**
- 粗算：`目标 ppm / 0.95 ≈ CALM 值`（减方向）
- **校准不是一次就完**：晶振漂移随温度/老化变，周期性对时后重新校准才靠谱

### 参考时钟检测（REFIN）

F4 多一个 `RTC_REFIN` 引脚：输入一路精确参考频率（50/60Hz 市电或精确方波），RTC 自动和 LSE 比较，偏差超限置 `REFCNTF` 标志——用来**在线监控晶振是否老化/漂移**，发现异常再触发校准或报警。要求 RTC 时钟源必须是 LSE，且参考频率要够稳。

### F1 怎么办

F1 没有数字校准。低成本做法：**软件校准**——每次对时记录偏差，累计误差超过阈值就整体修正时间；或对 LSE 负载电容做硬件微调。RTC 只走时、精度要求不高的场景，软件校完全够。

## 九、（F4 隐藏功能）亚秒 SSR 与影子寄存器

### 亚秒 SSR：比 1 秒更细的时间

F4 的同步预分频器 `PREDIV_S` 一路从 255 数到 0 才出一个秒脉冲，读数期间的值就是亚秒：

```c
uint32_t sub = HAL_RTCEx_GetSubSecond(&hrtc);   /* 0~255，越小离秒越近 */
float ms = (float)(255 - sub) / 256.0f * 1000.0f; /* 换算成毫秒 */
```

分辨率 = `1 / (PREDIV_S + 1)` 秒，255 时约 **3.9 ms**。用途：精确打点、测两次事件的时间间隔、给日志加亚秒时间戳。

### 影子寄存器：为什么读时间可能读到"错值"

F4 的 RTC 计数在备份域里自己跑，软件读 RTC_TR/DR 时读的是**影子寄存器（shadow）**——它把一次完整的进位先复制好再让软件读，避免读到"秒已+1 但分还没进位"的半截值。代价是**影子更新晚一个 RTC 周期**。极少数时序要求严格的场合设 `BYPSHAD=1` 直接读真实值，代价是可能读到进位中的错值——正常开发不要动它，HAL 的 GetTime 顺序已经帮你兜底了。

## 十、掉电保持：VBAT 电路与备份寄存器 BKP

### VBAT 怎么接

要"断电时间还在"，就得保证备份域一直有电：

- **长期**：CR2032 纽扣电池，主电源断开时给 VBAT 供电，RTC+LSE 待机电流几 µA，一颗电池撑几年
- **短期**：大电容（几 mF）搭到 VBAT，断电后撑几分钟到几十分钟，掉电抄表/记录最后状态够用
- **一直有电的系统**：VBAT 直接并 VDD 即可，反正不掉电

!!! tip "电池电压要覆盖 RTC 工作范围"
    纽扣电池电压和 RTC 工作电压范围要匹配（通常 1.8~3.6V），别选低于下限的电池，否则低温下 RTC 直接停摆。

### BKP 备份寄存器：掉电不丢的"储物柜"

- **F4**：`RTC_BKP0R~19R`，20 个 32 位寄存器，任何复位都清不掉，掉电也保持
- **F1**：`BKP_DR1~42`，42 个 16 位寄存器
- 用途：存 RTC 初始化标志（第四节）、存校准参数、存"上次掉电前的状态"，甚至**拿它当 NVM 用**（虽然擦写寿命有限，别当 Flash 用）

### 复位不丢，但掉电不一定不丢

再强调一次：**任何复位都清不掉 RTC 和 BKP，只有两件事会清它们**——VBAT 断电（电池也耗尽/拆掉）和 Tamper 触发。这既是 RTC 的可靠性来源，也是"首次初始化判断"必须存在的原因。

## 十一、常见坑汇总

- **每次上电都写时间** → 时间被重置回出厂。用 BKP 标志判断首次初始化（第四节）。
- **用 LSI 但指望断电后时间还在** → LSI 挂主电源域，断电即停。要断电保持用 LSE（第三节）。
- **LSE 起振慢就往下配** → 使能后不等 `LSERDY` 就初始化，配置写不进备份域。加几百 ms 等待。
- **F1 闹钟响一次就完** → 想循环必须中断里续写 ALR（第五节）。
- **F4 读时间顺序反了** → 先 GetTime 再 GetDate，反了可能读到跨秒错值（第四节）。
- **闹钟/唤醒没生效先查写保护** → PWR DBP 没开，RTC 寄存器根本写不进去（第三节）。
- **低功耗唤醒没反应** → 检查 EXTI 线（F4 闹钟/WUT 走 EXTI25，Tamper/时间戳走 EXTI26）在 NVIC 里使能了没。
- **Tamper 误触发把数据清了** → 入侵检测默认可能跟着你按的边沿就触发，配 `Filter` 防抖 + 明确选触发沿（第七节）。
- **时钟走快/走慢不是"坏了"** → 晶振漂移是常态，F4 用 Smooth 校准，F1 软件校（第八节）。

## 参考

- RTC 结构与寄存器细节：对应型号参考手册 **RTC 章节**（F1：RM0008；F4：RM0090）
- 时钟源 LSE/LSI 背景：见 [stm32-clock-tree.md](stm32-clock-tree.md)
- 低功耗唤醒与 EXTI 线：参考手册 **EXTI / 电源控制章节**
- F1/F4 HAL 接口差异：ST 官方 **STM32CubeF1 / STM32CubeF4** 的 `stm32f1xx_hal_rtc.c` 与 `stm32f4xx_hal_rtc_ex.c`
