# 디지털 그림책 서가

학생이 만든 디지털 그림책의 공유 링크를 반별 책장에 모아, 책등을 눌러 열어 볼 수 있게 만든 한국어 웹사이트입니다.

## Supabase 연결 및 첫 선생님 계정

1. `supabase-config.js`의 `publishableKey`에 Supabase Dashboard → Settings → API Keys의 **Publishable key**를 붙여넣습니다. Secret key나 데이터베이스 비밀번호는 절대 넣지 않습니다.
2. 해당 파일을 GitHub에 올리면 됩니다. Publishable key는 브라우저에 노출되는 용도의 키이며, 데이터 보호는 RLS 정책이 담당합니다.
3. 배포된 사이트에서 선생님 이메일 계정을 만듭니다. 이메일 인증이 켜져 있으면 받은 편지함의 인증 링크를 먼저 누릅니다.
4. Supabase Authentication → Users에서 선생님 계정의 UID를 복사한 뒤, SQL Editor에서 아래 한 줄을 실행해 첫 선생님 권한을 부여합니다.

```sql
update public.profiles
set role = 'teacher'
where id = '여기에_선생님_UID';
```

5. 사이트에서 다시 로그인하면 반을 만들 수 있습니다. 학생 제출물은 `제출 승인하기`에서 공개 또는 삭제합니다.

## 다른 선생님 초대 기능

`supabase-teacher-invites.sql`의 내용을 Supabase SQL Editor에서 **한 번만** 실행하세요. 이미 예전에 실행했더라도, 반 이름 생성 권한 보완이 포함되어 있으므로 최신 파일 전체를 다시 실행해도 안전합니다. 그 뒤 선생님 관리 화면의 `선생님 초대`에 동료 선생님의 이메일을 입력하면 됩니다.

- 초대받은 분이 이미 가입했다면 즉시 `teacher` 권한이 적용됩니다.
- 아직 가입 전이라면 초대 정보가 저장되고, 같은 이메일로 가입할 때 자동으로 선생님 권한이 적용됩니다.
- 이 권한 부여는 이미 `teacher`인 계정만 실행할 수 있도록 데이터베이스에서 제한됩니다.
- 반 이름은 한글과 띄어쓰기를 포함해 1~20자로 만들 수 있습니다.

## 오류·의견 접수

`supabase-feedback.sql` 전체를 Supabase SQL Editor에서 한 번 실행하면, 화면 왼쪽 아래의 `도움·오류 보내기`에서 받은 의견을 안전하게 저장할 수 있습니다.

- 내용은 띄어쓰기 포함 500자까지, 사진은 최대 2장·장당 5MB까지 받습니다.
- 사진은 공개 URL이 아닌 비공개 Supabase Storage에 저장됩니다.
- 선생님 계정은 Supabase의 Table Editor → `feedback_reports`에서 접수 내용을 볼 수 있습니다.
- 이메일 알림은 발송 서비스와 수신 이메일을 정한 뒤 별도로 연결합니다.

## 관리자 의견함

`supabase-admin.sql`을 SQL Editor에서 실행한 뒤, 관리자 본인의 UID에 아래 쿼리를 실행하세요.

```sql
update public.profiles
set role = 'admin'
where id = '관리자_UID';
```

관리자는 선생님 기능을 그대로 사용하면서 `접수된 의견 보기`에서 모든 피드백과 첨부 사진을 볼 수 있습니다. 일반 선생님과 학생은 이 메뉴와 접수 내용에 접근할 수 없습니다.

## 현재 배포판의 동작 방식

- 화면, 링크 등록, QR 코드 생성, 학생 제출 코드와 선생님 반영, 반별 백업을 지원합니다.
- Claude Artifact 전용 `window.claude.use()`와 `artifact.publish()` 의존성을 완전히 제거했습니다.
- Supabase 공개키가 설정되면 데이터는 Supabase에 저장되고, 공개된 책은 여러 기기에 실시간으로 표시됩니다.
- 공개키가 비어 있으면 기존 `localStorage` 데모 모드로만 실행됩니다.
- 휴대폰 화면에서는 책등을 더 작게 그려 한 줄에 최대 6권이 넘치지 않고, 320px급 작은 화면에서는 한 번 더 축소합니다. 헤더·버튼·모달도 좁은 화면에 맞게 재배치됩니다.

## 로컬 실행

별도 설치가 필요 없는 정적 사이트입니다. 프로젝트 폴더에서 다음처럼 간단한 웹 서버를 실행한 뒤 표시된 주소를 엽니다.

```bash
python3 -m http.server 4173
```

## 정적 배포

GitHub Pages, Vercel, Netlify 모두 적합합니다. 빌드 명령과 환경 변수는 필요 없습니다.

- **GitHub Pages**: 저장소에 이 폴더의 파일을 올리고 Settings → Pages에서 `main` 브랜치의 루트 폴더를 선택합니다.
- **Vercel**: 새 프로젝트에서 저장소를 가져온 뒤 Framework Preset을 `Other`로 두고 배포합니다.
- **Netlify**: 이 폴더를 드래그 앤 드롭하거나 저장소를 연결합니다. Publish directory는 `.`입니다.

정적 시범 공개는 Vercel 또는 Netlify가 가장 간단합니다. 교육용 사이트의 실제 반별 공동 책장으로 쓰려면 아래처럼 백엔드를 연결하세요.

## 여러 기기에서 실제 공유하려면

가장 권하는 조합은 **Vercel + Supabase**입니다.

1. Supabase Auth에서 선생님만 이메일/Google 로그인으로 인증합니다.
2. `classes`(반 코드, 이름, 교사 ID)와 `books`(반 ID, 제목, 지은이, URL, 색상) 테이블을 만듭니다.
3. 학생은 반 코드로 읽고 등록하도록 제한하고, 수정·삭제와 반 생성은 교사 ID의 Row Level Security 정책으로 제한합니다.
4. Supabase Realtime 구독을 추가하면 학생이 등록한 책이 모두의 화면에 즉시 나타납니다.

대안으로 Firebase(특히 이미 Google Workspace/Firebase를 쓰는 학교)도 좋습니다. Firestore 실시간 동기화와 Google 로그인이 편하지만, 권한 규칙을 신중하게 설정해야 합니다. QR 이미지 자체를 저장하려면 Supabase Storage 또는 Firebase Storage를 함께 쓰고, 이미지 크기/형식을 제한하세요.

## 주의할 점

- 현재 업로드 QR 방식은 data URL로 브라우저 저장소에 넣으므로 큰 이미지나 많은 이미지는 저장 한도에 걸릴 수 있습니다.
- 이 프로젝트는 학생 이름, 책 링크를 다룰 수 있으므로 공개 배포 전 개인정보 노출 여부와 외부 링크의 안전성을 검토하세요.
