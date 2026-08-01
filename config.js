/**
 * 개인 설정 파일.
 *
 * CLIENT_ID 는 비밀값이 아니라 공개돼도 되는 값입니다.
 * (Google OAuth "웹 애플리케이션" 클라이언트 ID — 승인된 원본으로만 사용 제한됨)
 * 자세한 발급 방법은 README.md 3번 항목 참고.
 */
window.ARCHIVE_CONFIG = {
  // 예: "1234567890-abcdefghijklmnop.apps.googleusercontent.com"
  CLIENT_ID: "여기에_OAuth_클라이언트_ID_붙여넣기",

  // 백업이 쌓일 구글 드라이브 폴더 이름 (앱이 처음 실행될 때 자동 생성)
  DRIVE_FOLDER: "ARCHIVE-Backups",

  // ZIP 만들 때 통째로 건너뛸 폴더/파일 이름
  SKIP: [
    ".git", "node_modules", ".venv", "venv", "__pycache__",
    "dist", "build", "out", ".next", "target", "bin", "obj",
    ".gradle", ".idea", ".vs", "Thumbs.db", ".DS_Store",
  ],

  // 이 크기를 넘으면 브라우저 메모리 부담이 커서 경고 (바이트)
  WARN_SIZE: 1.5 * 1024 * 1024 * 1024,
};
