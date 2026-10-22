# 🦾 ESP32 / MSP432 7-Servo Bionic Hand Web Controller & Animation Studio

A web application and 50Hz motion interpolation studio for the 7-servo Bionic Hand, accessible directly from the browser with no local drivers or server needed.

🌐 **Live Web Controller**: [https://anmolp5.github.io/bionichand/](https://anmolp5.github.io/bionichand/)

---

## ✨ Features

- **Direct Web Serial Control (`navigator.serial`)**: Connect straight to the ESP32 board over a standard USB-C cable directly from Google Chrome, Microsoft Edge, Opera, or Arc.
- **Client-Side 50Hz Motion Interpolation Engine**: Smooth multi-pose transitions using Cosine S-Curve, Linear, and Exponential interpolation algorithms.
- **Smart 3-Phase Collision-Avoidance Sequencer**:
  1. **Phase 1**: Automatic Thumb clearance retract if extended.
  2. **Phase 2**: Finger tile groups execution (Index, Middle, Ring, Pinky) with configurable Wait / Delay timing.
  3. **Phase 3**: Thumb final positioning.
- **Kinematic Coupling**: Built-in coupling compensation between *Thumb Pivot* and *Thumb Curl*.
- **Poses & Keyframing Library**: Create, save, and update custom hand poses and complex multi-keyframe animations.
- **Persistence & Export**: Automatic local storage caching with 1-click **Export JSON** and **Import JSON** tools.
- **Real-Time Terminal Console**: View live TX/RX serial telemetry packets (`A:<p0>,<p1>,...,<p6>`) with millisecond timestamps.

---

## 🔌 Hardware Pinout (ESP32 Development Board)

| Channel | Joint Name | Header | ESP32 GPIO Pin | Default Direction | Safe Limit |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **0** | Index | **J1** | `GPIO 13` | CW | 110° |
| **1** | Middle | **J2** | `GPIO 27` | CW | 175° |
| **2** | Ring | **J3** | `GPIO 26` | CW | 130° |
| **3** | Pinky | **J4** | `GPIO 25` | CCW | 115° |
| **4** | Thumb Base | **J5** | `GPIO 33` | CCW | 55° |
| **5** | Thumb Pivot | **J6** | `GPIO 32` | CW | 45° |
| **6** | Thumb Curl | **J7** | `GPIO 23` | CCW | 125° |

---

## 🚀 How to Use

1. Open **[https://anmolp5.github.io/bionichand/](https://anmolp5.github.io/bionichand/)** in **Google Chrome**, **Edge**, or any browser supporting Web Serial.
2. Plug your ESP32 Bionic Hand into your computer via USB-C.
3. Click the green **Connect** button in the top navigation bar.
4. Select the serial port (e.g., `CP2102 USB to UART Bridge Controller` or `USB Serial`) in the browser pop-up.
5. Move the sliders to test individual servos, click any pose from the library, or launch animations from the Animation Studio!

---

## 🛠 Local Development

To run locally with Python Flask:
```bash
python3 web_app.py
```
Open `http://localhost:5050` in your browser.
