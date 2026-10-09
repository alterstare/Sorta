<p align="center"><img src="build/icons/128x128.png" width="96" alt="Sorta"></p>

# Sorta

2D 게임 · 애니메이션 캐릭터 그림을 **게임 → 소속 → 캐릭터** 단위로 자동 분류하고, 원본을 폴더로 정리해 주는 PC 앱입니다. Windows / Linux용입니다.

## 할 수 있는 것

- **자동 분류** — 그림 폴더를 등록하면 캐릭터와 등급(일반 · 민감 · R-18)을 붙입니다. 확실한 것은 자동으로 확정하고, 애매한 것만 검토 화면에서 묻습니다.
- **검토** — 후보 캐릭터를 참고 그림과 나란히 보고 1 · 2 · 3, Enter 같은 단축키로 빠르게 고릅니다.
- **캐릭터 학습** — 모델이 모르는 캐릭터는 Danbooru(차단 우회 내장) / Safebooru 참고 그림으로 학습합니다. 검토에서 직접 고른 그림도 바로 학습에 쓰입니다.
- **소속 조직도** — 학교 · 동아리 같은 소속을 조직도로 관리하고, 게임 위키에서 소속을 찾아 제안받을 수 있습니다.
- **폴더 정리** — 확정된 원본을 `게임/소속/캐릭터` 폴더로 옮깁니다. 모든 이동은 Ctrl+Z로 원래 자리로 되돌릴 수 있습니다.
- **라이브러리** — 탐색기처럼 격자 / 목록으로 보고, 즐겨찾기 · 평점 · 그룹 · 중복 정리 · 등급 필터를 씁니다.
- **공유 파일** — 소속 조직도 · 캐릭터 · 학습 데이터를 `.sortapack` 파일로 내보내 다른 사람과 나눌 수 있습니다.

## 설치

[Releases](https://github.com/alterstare/Sorta/releases)에서 받습니다.

| 파일 | 설명 |
|---|---|
| `Sorta-Setup-x.y.z.exe` | Windows 설치판 (자동 업데이트) |
| `Sorta-x.y.z-win.zip` | Windows 압축판 (설치 없이 실행, 자동 업데이트 없음) |
| `Sorta-x.y.z.AppImage` | Linux (자동 업데이트) |
| `Sorta-x.y.z.tar.gz` | Linux 압축판 |

코드 서명이 없어서 Windows에서 처음 실행할 때 SmartScreen 경고가 뜰 수 있습니다. "추가 정보 → 실행"을 누르면 됩니다.

## 처음 쓸 때

1. **설정 → 모델**에서 기본 태거(WD SwinV2 v3, 약 450MB)를 받습니다. 모델은 설치 파일에 들어 있지 않고 앱 안에서 받습니다.
2. **설정 → 폴더**에서 원본 폴더를 추가하고 "가져오기 실행"을 누릅니다.
3. 필요하면 보조 모델(PixAI · Camie)과 캐릭터 학습 모델(CCIP)도 받습니다.
4. 정리 폴더를 정하고 "폴더 정리 → 미리 보기"로 확인한 뒤 옮깁니다.

GPU: Windows는 DirectML(NVIDIA · AMD · Intel), Linux는 CUDA(NVIDIA 드라이버 + CUDA 12 + cuDNN 9 필요)를 쓰고, 안 되면 CPU로 동작합니다.

## 개인정보

- **그림과 그림에서 나온 데이터(썸네일 · 태그 · 특징값)는 PC 밖으로 보내지 않습니다.**
- 밖으로 나가는 통신은 모델 받기, 앱 업데이트 확인, 그리고 설정에서 켠 경우에만 하는 캐릭터 **이름** 조회(참고 그림 받기, 위키 소속 찾기)뿐입니다.
- 원본 파일의 내용은 바꾸지 않습니다. 정리할 때는 옮기기만 하고, 지우는 기능은 없습니다.

## 모델과 라이선스

| 모델 | 용도 | 라이선스 |
|---|---|---|
| [SmilingWolf/wd-swinv2-tagger-v3](https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3) | 등급 + 캐릭터 (기본) | Apache-2.0 |
| [deepghs/pixai-tagger-v0.9-onnx](https://huggingface.co/deepghs/pixai-tagger-v0.9-onnx) | 보조 캐릭터 판정 | Apache-2.0 |
| [Camais03/camie-tagger-v2](https://huggingface.co/Camais03/camie-tagger-v2) | 보조 캐릭터 판정 (선택) | GPL-3.0 — 앱에 포함하지 않고 사용자가 직접 받습니다 |
| [deepghs/ccip_onnx](https://huggingface.co/deepghs/ccip_onnx) | 캐릭터 학습 (특징값) | OpenRAIL |
| [deepghs/anime_person_detection](https://huggingface.co/deepghs/anime_person_detection) | 인물 검출 | MIT |

Sorta 자체는 [MIT 라이선스](LICENSE)입니다.

## 개발

```
npm install          # better-sqlite3 Electron 빌드도 함께 받습니다
npm run dev          # 개발 실행
npm test             # vitest (Electron Node로 실행)
npm run typecheck
npm run icons        # sorta icon.png → build/ 아이콘 다시 만들기
npm run dist         # 설치판 만들기
```

릴리스: Windows는 로컬에서 `npx electron-builder --win --publish always`(GH_TOKEN 필요)로 올리고, `v*` 태그를 올리면 GitHub Actions가 Linux 파일을 같은 릴리스에 추가합니다.
