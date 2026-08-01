# ARCHIVE — 개인 백업 콘솔

바탕화면의 작업 폴더를 브라우저에서 골라 **ZIP 으로 압축 → 내 구글 드라이브에 업로드**하고,
올려둔 백업 목록을 보고 다시 내려받는 정적 페이지. GitHub Pages 로 호스팅한다.

- 파일 실체는 **구글 드라이브에만** 저장된다. GitHub 저장소에는 페이지 코드만 올라간다.
- 권한 범위는 `drive.file` — **이 페이지가 만든 파일 외에는 내 드라이브를 볼 수 없다.**
- 서버가 없다. 로그인 토큰은 탭 메모리에만 있고 새로고침하면 사라진다.

```
ARCHIVE/
├─ index.html          페이지 본문
├─ config.js           ★ 여기에 OAuth 클라이언트 ID 를 넣는다
├─ backup.ps1          큰 폴더용 로컬 ZIP 스크립트 (선택)
├─ serve.js            로컬 테스트용 정적 서버 (Node 내장 모듈만)
└─ assets/
   ├─ app.js           화면 로직
   ├─ drive.js         Drive API 래퍼
   ├─ zip.js           의존성 없는 ZIP 생성기
   └─ style.css
```

---

## 1. GitHub 저장소 만들기

GitHub 에서 새 저장소를 하나 만든다 (이름 예: `archive`, **Public** 권장 —
Private 저장소로 Pages 를 쓰려면 유료 플랜이 필요하다).
저장소 코드에는 개인 파일이 들어가지 않으므로 Public 이어도 노출되는 건 페이지 코드뿐이다.

그다음 이 폴더에서:

```bash
git init -b main && git add . && git commit -m "ARCHIVE 백업 콘솔" && git remote add origin https://github.com/<깃허브아이디>/archive.git && git push -u origin main
```

> 처음 커밋한다면 이름/이메일부터:
> ```bash
> git config --global user.name "이름" && git config --global user.email "메일주소"
> ```

## 2. GitHub Pages 켜기

저장소 → **Settings → Pages** → Source 를 **Deploy from a branch**,
Branch 를 **main / (root)** 로 두고 Save.

1~2분 뒤 주소가 나온다: `https://<깃허브아이디>.github.io/archive/`

## 3. Google OAuth 클라이언트 ID 발급 ★

1. [Google Cloud Console](https://console.cloud.google.com/) 에서 프로젝트를 새로 만든다 (이름 아무거나).
2. **API 및 서비스 → 라이브러리** 에서 **Google Drive API** 를 검색해 **사용 설정**.
3. **API 및 서비스 → OAuth 동의 화면**
   - User Type: **외부(External)**
   - 앱 이름/지원 이메일만 채우고 저장
   - 범위(스코프)는 추가하지 않아도 된다. `drive.file` 은 민감하지 않은 범위라 앱 심사가 필요 없다.
   - **대상(테스트 사용자)** 에 본인 구글 계정을 추가한다.
4. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - **승인된 자바스크립트 원본** 에 두 개를 추가:
     - `https://<깃허브아이디>.github.io`
     - `http://localhost:8080` (로컬 테스트용)
   - 리디렉션 URI 는 **비워둔다** (이 페이지는 토큰 방식이라 필요 없다)
5. 나온 클라이언트 ID (`...apps.googleusercontent.com`) 를 `config.js` 의 `CLIENT_ID` 에 붙여넣는다.

```js
CLIENT_ID: "1234567890-abcdefg.apps.googleusercontent.com",
```

6. 커밋 후 다시 push 하면 끝.

```bash
git add config.js && git commit -m "OAuth 클라이언트 ID 설정" && git push
```

> 클라이언트 ID 는 **비밀값이 아니다.** 위에 등록한 도메인에서만 쓸 수 있어서 공개돼도 문제없다.
> 반대로 클라이언트 **시크릿**은 이 페이지에서 쓰지 않으니 절대 넣지 말 것.

---

## 쓰는 법

1. 페이지 접속 → **Google 로그인** (처음 한 번 권한 동의)
   - "확인되지 않은 앱" 경고가 뜨면 *고급 → 안전하지 않은 페이지로 이동*. 본인이 만든 앱이라 정상이다.
2. **폴더 선택…** → 백업할 작업 폴더를 고른다
   - `node_modules`, `.git`, `dist` 등은 `config.js` 의 `SKIP` 목록대로 자동 제외
3. ZIP 이름·메모를 확인하고 **백업 실행**
4. 아래 목록에서 다운로드 / 드라이브에서 열기 / 휴지통 이동

### 큰 폴더 (1.5GB 이상)

브라우저 압축은 메모리에 통째로 올리므로 큰 폴더는 로컬 스크립트를 쓴다:

```bash
powershell -ExecutionPolicy Bypass -File backup.ps1 -Path "..\vodo","..\glados"
```

`backups\` 에 생긴 ZIP 을 페이지의 **ZIP 파일 올리기** 로 업로드하면 된다.
(`backups/` 는 `.gitignore` 에 있어 깃에 올라가지 않는다)

### 로컬에서 먼저 테스트

```bash
node serve.js
```

→ `http://localhost:8080` 접속. 3번 단계에서 이 주소를 승인된 원본에 넣어뒀어야 로그인이 된다.
(`file://` 로 직접 열면 ES 모듈과 구글 로그인이 막히니 반드시 http 로 열 것)

---

## 알아둘 것

| 항목 | 내용 |
|---|---|
| 브라우저 | 폴더 선택은 **Chrome / Edge** 권장. Firefox·Safari 는 대체 방식으로 동작하지만 제외 규칙이 덜 정확할 수 있다. |
| ZIP 크기 | ZIP64 미지원 → 결과물 4GB 초과 시 오류. 폴더를 나누거나 `backup.ps1` 사용. |
| 로그인 유지 | 토큰은 약 1시간. 만료되면 다시 로그인 버튼을 누른다. |
| 삭제 | 목록의 "휴지통" 은 영구 삭제가 아니라 드라이브 휴지통 이동(30일 복구 가능). |
| 드라이브 용량 | 무료 계정 15GB 공유. 백업이 쌓이면 오래된 것부터 정리할 것. |
