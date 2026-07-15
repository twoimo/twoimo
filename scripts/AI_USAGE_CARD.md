# AI Coding Usage Card

프로필의 `AI coding activity` 카드는 로컬에 쌓인 AI 코딩 CLI 로그를 `ccusage`로 집계해 SVG로 생성합니다.

- 감지 대상: Claude Code, Codex, Gemini CLI, Copilot CLI 및 `ccusage`가 지원하는 도구
- 저장 위치: `profile/ai-usage-*.svg`
- 데이터 처리: 로컬 로그를 로컬에서 읽고, 완성된 SVG만 GitHub 프로필 저장소에 커밋
- 카드 호스팅: 외부 카드 서버 없이 `twoimo/twoimo` 저장소에서 직접 제공

## Windows 설치

### 요구 사항

- Node.js 18 이상
- GitHub CLI
- `gh auth login` 완료

PowerShell에서 다음 명령을 실행합니다.

```powershell
$installer = Join-Path $env:TEMP 'install-ai-usage-card.ps1'
Invoke-WebRequest `
  'https://raw.githubusercontent.com/twoimo/twoimo/main/scripts/install-ai-usage-card.ps1' `
  -OutFile $installer
powershell -ExecutionPolicy Bypass -File $installer
```

설치 스크립트는 다음 작업을 수행합니다.

1. `%LOCALAPPDATA%\twoimo-ai-usage-card`에 생성기를 설치
2. 첫 사용량 카드를 즉시 생성해 `twoimo/twoimo`에 커밋
3. Windows 작업 스케줄러에 매일 09:37 자동 갱신 작업 등록
4. PC가 해당 시간에 꺼져 있었다면 다음 사용 가능 시점에 실행

## 수동 갱신

```powershell
powershell -ExecutionPolicy Bypass -File `
  "$env:LOCALAPPDATA\twoimo-ai-usage-card\run-ai-usage-card.ps1"
```

로그:

```text
%LOCALAPPDATA%\twoimo-ai-usage-card\ai-usage-card.log
```

## 로컬 미리보기

저장소를 클론한 뒤 GitHub에 커밋하지 않고 SVG만 확인할 수 있습니다.

```powershell
$env:USAGE_CARD_LOCAL = '1'
node .\scripts\ai-usage-card.mjs
Remove-Item Env:USAGE_CARD_LOCAL
```

기본 미리보기 출력 폴더는 `ai-usage-preview`입니다.

## 제거

```powershell
Unregister-ScheduledTask -TaskName 'TWOIMO AI Usage Card' -Confirm:$false
Remove-Item "$env:LOCALAPPDATA\twoimo-ai-usage-card" -Recurse -Force
```

## 생성되는 카드

| 파일 | 용도 |
| --- | --- |
| `profile/ai-usage-combo.svg` | 프로필에 표시되는 토큰·비용·26주 활동 통합 카드 |
| `profile/ai-usage-full.svg` | 토큰 구성, 활동, 도구별 비용까지 포함한 상세 카드 |
| `profile/ai-usage-half.svg` | 누적 토큰과 비용 요약 |
| `profile/ai-usage-grass.svg` | AI 사용량 잔디만 표시 |
| `profile/ai-usage-half-grass.svg` | 요약 카드와 잔디를 세로 배치 |

## Attribution

The generator is adapted from [Baek-Seunghyun/ai-coding-usage-card](https://github.com/Baek-Seunghyun/ai-coding-usage-card), licensed under the MIT License. The upstream copyright and license notice are preserved in `scripts/ai-usage-card.LICENSE`.
