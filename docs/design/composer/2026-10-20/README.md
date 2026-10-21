# Composer 设计画板（2026-10-20 一轮）

本目录是 composer 设计画板的源文件快照，用于对照实现。在线画板：
https://claude.ai/artifact/VzJdCUhyvY88kr26qo211T（发布版本 17）。

| 文件 | 画板 |
| --- | --- |
| `Main.dc.html` | 深色·空闲：顶部条展开 |
| `Running.dc.html` | 深色·运行中：顶部条折叠为一行 |
| `Light.dc.html` | 浅色·空闲：顶部条展开 |
| `Menu.dc.html` | 深色·菜单展开 |
| `States.dc.html` | 深色·点击状态 |
| `Model.dc.html` | 模型切换（示例数据；标「提议」的为新增） |
| `Context.dc.html` | 上下文用量：统一按已用显示，阈值按剩余 |
| `InputStates.dc.html` | 输入卡状态：聚焦、拖入、锁定 |
| `Queue.dc.html` | 待发送消息：方案 1，默认收起为摘要条，展开为扁平列表 |

`canvas.json` 记录画板在设计画布上的位置和尺寸。

画板依赖设计画布的运行时（`./support.js`），不能直接用浏览器打开。
这里的内容是设计意图；实现状态以代码和规格为准。
