(() => {
  const LANGUAGE_KEY = "mbo-ui-language-v1";

  const LANGUAGES = [
    { code:"ko", label:"한국어", dir:"ltr" },
    { code:"en", label:"English", dir:"ltr" },
    { code:"zh-CN", label:"中文（简体）", dir:"ltr" },
    { code:"zh-TW", label:"中文（繁體）", dir:"ltr" },
    { code:"ja", label:"日本語", dir:"ltr" },
    { code:"es", label:"Español", dir:"ltr" },
    { code:"fr", label:"Français", dir:"ltr" },
    { code:"de", label:"Deutsch", dir:"ltr" },
    { code:"pt", label:"Português", dir:"ltr" },
    { code:"ru", label:"Русский", dir:"ltr" },
    { code:"ar", label:"العربية", dir:"rtl" },
    { code:"hi", label:"हिन्दी", dir:"ltr" },
    { code:"id", label:"Bahasa Indonesia", dir:"ltr" },
    { code:"vi", label:"Tiếng Việt", dir:"ltr" },
    { code:"th", label:"ไทย", dir:"ltr" }
  ];

  // Korean source text -> English. This is the full fallback pack.
  const EN = {
    "나의 생활 MBO":"My Life MBO","오늘 뭘 채웠나요?":"What did you fill today?","카테고리를 눌러서 기록해 보세요.":"Choose a category to add a record.",
    "나의 생활 그리드":"My Life Grid","전체 연도 요약":"All-year summary","해가 쌓일수록 비교가 더 의미 있어져요":"Comparisons become more meaningful as the years build up",
    "낮음":"Low","높음":"High","적게":"Less","많이":"More","월":"Mon","수":"Wed","금":"Fri","최근 12주":"Last 12 weeks",
    "🌿 나의 생활 회고 보기":"🌿 View my life review","← MBO 메인":"← MBO home","← 뒤로":"← Back","← 홈":"← Home",
    "나의 목표":"My goal","설정됨":"Set","목표 미설정":"No goal yet","목표 만들기":"Create goal","목표 수정":"Edit goal","오늘의 한마디":"A note for today",
    "오늘 기록":"Today's record","기록 모아보기 →":"View all records →","기록":"Records","전체 기록":"All records","날짜 선택해서 기록하기":"Add a record by date","저장":"Save",
    "연간 기록":"Yearly records","기록 없음":"No record","달성":"Done","미달성":"Not achieved","미완료":"Not done","완료":"Done","월별 평균":"Monthly average","주당 평균 달성 횟수":"Average completions per week",
    "생활 회고":"Life review","독서와 내가 설정한 목표들을 한 번에 돌아봐요.":"Review reading and all of your goals together.","한 해의 생활 그리드":"Yearly life grid","목표별 돌아보기":"Review by goal",
    "나의 서재":"My Library","서재":"Library","100권 읽기 프로젝트":"100-book reading project","지금까지":"So far","권":"books","목표까지 100권 남았어요":"100 books left to your goal",
    "완독":"Finished","읽는 중":"Reading","총 독서시간":"Total reading time","서재 기록 이전에 읽은 책":"Books read before this library","권 (직접 입력 가능)":"books (editable)",
    "나의 서재 들어가기 →":"Enter my library →","📖 독서 회고 보기":"📖 View reading review","이번 주 목표":"This week's goal","주간 목표":"Weekly goal",
    "연속 독서 · 출석 스티커":"Reading streak · attendance stickers","나의 책갈피":"My bookmarks","뱃지":"Badges","완독 예상일(목표 완독일)보다 일찍 끝내면 ⚡ 앞당김 뱃지를 받아요.":"Finish before your expected date to earn a ⚡ ahead-of-plan badge.",
    "올해 독서 기록":"Reading activity this year","타이머로 기록한 날이 표시돼요. 진할수록 그날 더 오래 읽은 거예요.":"Days recorded by the timer are shown. Darker means more reading time.",
    "주간 독서 시간":"Weekly reading time","(분)":"(min)","월별 완독 권수":"Books finished by month","연도별 완독":"Books finished by year","(가장 많이 읽은 달 표시)":"(shows your busiest month)","장르별 권수":"Books by genre",
    "제목·저자 검색":"Search title or author","전체":"All","읽고 싶음":"Want to read","시작 전":"Not started","중단":"Dropped","최근 업데이트순":"Recently updated","진행률순":"Progress","제목순":"Title",
    "그리드":"Grid","보드":"Board","회고":"Review","내보내기":"Export","가져오기":"Import","전체 공개":"Make all public","전체 비공개":"Make all private","🔗 공유 링크":"🔗 Share link",
    "📖 왼쪽 위 눈 아이콘을 눌러 책마다 공개·비공개를 정해요 (기본은 비공개)":"📖 Use the eye icon to choose public/private for each book (private by default)",
    "독서 회고":"Reading review","새 책 추가":"Add a new book","제목으로 정보 가져오기":"Find book info by title","검색":"Search","제목":"Title","저자":"Author","출판사":"Publisher","옮긴이 (있다면)":"Translator (if any)","총 페이지 수":"Total pages","상태":"Status","취소":"Cancel","추가하기":"Add",
    "공유 링크 만들기":"Create share link","친구에게 보여줄 이름":"Name shown to friends","공유 링크":"Share link","닫기":"Close","다시 만들기":"Regenerate","링크 복사":"Copy link",
    "👀 친구의 서재 (공유 스냅샷)":"👀 Friend's library (shared snapshot)","비공개로 둔 책은 보이지 않아요. 이 화면은 링크를 받은 시점의 스냅샷이라 실시간으로 바뀌지 않아요.":"Private books are hidden. This is a snapshot from when the link was created, not a live view.",
    "PDF":"PDF","Excel (.xlsx)":"Excel (.xlsx)","Markdown (.md)":"Markdown (.md)","CSV (.csv)":"CSV (.csv)","백업 (.json)":"Backup (.json)",
    "홈 요약 → 서재 목록 → 책별 페이지로 정리된 문서":"A document with home summary → library list → one page per book","책 목록 · 문구 · 독서 기록이 시트별로 나뉘어요":"Books, quotes and reading records are split into sheets","노션에 그대로 붙여넣거나 가져오기 할 수 있어요":"Paste into or import directly to Notion","노션 데이터베이스나 구글 시트로 가져오기용 책 목록":"Book list for Notion databases or Google Sheets","기록 전체를 그대로 저장해두는 파일. \"가져오기\"로 복원할 수 있어요":"A full backup of your records. Restore it with Import.",
    "큐티":"Quiet time","일기":"Diary","오늘의 생각":"Thoughts","아침운동":"Morning workout","저녁운동":"Evening workout","일찍 일어나기":"Wake up early","일찍 자기":"Go to bed early","독서":"Reading",
    "습관":"Habit","목표를 아직 설정하지 않았어요":"No goal set yet","아직 구체적인 목표가 없어도 괜찮아요. 여기서 하나씩 정할 수 있어요.":"It's okay if your goal isn't specific yet. You can shape it here step by step.",
    "3단계로 목표 만들기 →":"Create a goal in 3 steps →","무엇을 만들고 싶나요?":"What do you want to build?","왜 이걸 하고 싶나요?":"Why do you want this?","현실적으로 얼마나 자주 할까요?":"How often is realistic?","다음 →":"Next →","← 이전":"← Previous","이 목표로 시작하기":"Start with this goal",
    "오늘 완료함 ✓":"Done today ✓","오늘 완료로 표시":"Mark today as done","내용":"Note","기상":"Wake-up","취침":"Bedtime","기준":"Target",
    "최근 30일":"Last 30 days","이번 달 평균":"This month's average","이번 주":"This week","지난주":"Last week","최근 4주 평균":"4-week average",
    "목표 시작 전":"Before goal start","기록 시작 전":"Before records started","미래 날짜":"Future date","오늘":"Today","아직 없음":"None yet","아직 기록 없음":"No records yet",
    "친구 코드":"friend code","책 한 권, 프로젝트 하나":"One book, one project"
  };

  const PACKS = {
    en: EN,
    "zh-CN": {
      "나의 생활 MBO":"我的生活 MBO","오늘 뭘 채웠나요?":"今天完成了什么？","카테고리를 눌러서 기록해 보세요.":"选择一个类别开始记录。","나의 생활 그리드":"我的生活网格","전체 연도 요약":"全部年度摘要","낮음":"低","높음":"高","최근 12주":"最近12周","🌿 나의 생활 회고 보기":"🌿 查看生活回顾","← MBO 메인":"← MBO 首页","← 뒤로":"← 返回","← 홈":"← 首页","나의 목표":"我的目标","오늘 기록":"今日记录","기록 모아보기 →":"查看全部记录 →","전체 기록":"全部记录","날짜 선택해서 기록하기":"按日期添加记录","저장":"保存","연간 기록":"年度记录","기록 없음":"无记录","달성":"达成","미달성":"未达成","완료":"完成","월별 평균":"月平均","생활 회고":"生活回顾","한 해의 생활 그리드":"年度生活网格","목표별 돌아보기":"按目标回顾","나의 서재":"我的书房","100권 읽기 프로젝트":"100本阅读计划","지금까지":"目前","완독":"读完","읽는 중":"阅读中","총 독서시간":"总阅读时间","나의 서재 들어가기 →":"进入我的书房 →","📖 독서 회고 보기":"📖 查看阅读回顾","이번 주 목표":"本周目标","연속 독서 · 출석 스티커":"连续阅读 · 签到贴纸","나의 책갈피":"我的书签","뱃지":"徽章","올해 독서 기록":"今年阅读记录","주간 독서 시간":"每周阅读时间","(분)":"（分钟）","월별 완독 권수":"每月读完本数","연도별 완독":"年度读完","장르별 권수":"按类型统计","전체":"全部","읽고 싶음":"想读","시작 전":"未开始","중단":"中止","최근 업데이트순":"最近更新","진행률순":"按进度","제목순":"按标题","그리드":"网格","보드":"看板","회고":"回顾","내보내기":"导出","가져오기":"导入","전체 공개":"全部公开","전체 비공개":"全部私密","🔗 공유 링크":"🔗 分享链接","독서 회고":"阅读回顾","새 책 추가":"添加新书","검색":"搜索","제목":"标题","저자":"作者","출판사":"出版社","옮긴이 (있다면)":"译者（如有）","총 페이지 수":"总页数","상태":"状态","취소":"取消","추가하기":"添加","공유 링크 만들기":"创建分享链接","친구에게 보여줄 이름":"展示给朋友的名字","공유 링크":"分享链接","닫기":"关闭","다시 만들기":"重新生成","링크 복사":"复制链接","큐티":"灵修","일기":"日记","오늘의 생각":"今日想法","아침운동":"晨练","저녁운동":"晚间运动","일찍 일어나기":"早起","일찍 자기":"早睡","독서":"阅读","습관":"习惯","목표를 아직 설정하지 않았어요":"尚未设置目标","3단계로 목표 만들기 →":"用3步创建目标 →","무엇을 만들고 싶나요?":"你想养成什么？","왜 이걸 하고 싶나요?":"为什么想这样做？","현실적으로 얼마나 자주 할까요?":"现实地说多久做一次？","다음 →":"下一步 →","← 이전":"← 上一步","이 목표로 시작하기":"从这个目标开始","오늘 완료함 ✓":"今天已完成 ✓","오늘 완료로 표시":"标记今天完成","최근 30일":"最近30天","이번 달 평균":"本月平均","이번 주":"本周","지난주":"上周","최근 4주 평균":"近4周平均","오늘":"今天"
    },
    "zh-TW": {
      "나의 생활 MBO":"我的生活 MBO","오늘 뭘 채웠나요?":"今天完成了什麼？","카테고리를 눌러서 기록해 보세요.":"選擇一個類別開始記錄。","나의 생활 그리드":"我的生活網格","전체 연도 요약":"全部年度摘要","낮음":"低","높음":"高","최근 12주":"最近12週","🌿 나의 생활 회고 보기":"🌿 查看生活回顧","← MBO 메인":"← MBO 首頁","← 뒤로":"← 返回","← 홈":"← 首頁","나의 목표":"我的目標","오늘 기록":"今日記錄","기록 모아보기 →":"查看全部記錄 →","전체 기록":"全部記錄","날짜 선택해서 기록하기":"按日期新增記錄","저장":"儲存","연간 기록":"年度記錄","기록 없음":"無記錄","달성":"達成","미달성":"未達成","완료":"完成","월별 평균":"月平均","생활 회고":"生活回顧","한 해의 생활 그리드":"年度生活網格","목표별 돌아보기":"按目標回顧","나의 서재":"我的書房","100권 읽기 프로젝트":"100本閱讀計畫","지금까지":"目前","완독":"讀完","읽는 중":"閱讀中","총 독서시간":"總閱讀時間","나의 서재 들어가기 →":"進入我的書房 →","📖 독서 회고 보기":"📖 查看閱讀回顧","이번 주 목표":"本週目標","연속 독서 · 출석 스티커":"連續閱讀 · 簽到貼紙","나의 책갈피":"我的書籤","뱃지":"徽章","올해 독서 기록":"今年閱讀記錄","주간 독서 시간":"每週閱讀時間","(분)":"（分鐘）","월별 완독 권수":"每月讀完本數","연도별 완독":"年度讀完","장르별 권수":"按類型統計","전체":"全部","읽고 싶음":"想讀","시작 전":"未開始","중단":"中止","최근 업데이트순":"最近更新","진행률순":"按進度","제목순":"按標題","그리드":"網格","보드":"看板","회고":"回顧","내보내기":"匯出","가져오기":"匯入","전체 공개":"全部公開","전체 비공개":"全部私人","🔗 공유 링크":"🔗 分享連結","독서 회고":"閱讀回顧","새 책 추가":"新增書籍","검색":"搜尋","제목":"標題","저자":"作者","출판사":"出版社","옮긴이 (있다면)":"譯者（如有）","총 페이지 수":"總頁數","상태":"狀態","취소":"取消","추가하기":"新增","공유 링크 만들기":"建立分享連結","친구에게 보여줄 이름":"顯示給朋友的名字","공유 링크":"分享連結","닫기":"關閉","다시 만들기":"重新產生","링크 복사":"複製連結","큐티":"靈修","일기":"日記","오늘의 생각":"今日想法","아침운동":"晨間運動","저녁운동":"晚間運動","일찍 일어나기":"早起","일찍 자기":"早睡","독서":"閱讀","습관":"習慣","목표를 아직 설정하지 않았어요":"尚未設定目標","3단계로 목표 만들기 →":"用3步建立目標 →","무엇을 만들고 싶나요?":"你想養成什麼？","왜 이걸 하고 싶나요?":"為什麼想這樣做？","현실적으로 얼마나 자주 할까요?":"實際上多久做一次？","다음 →":"下一步 →","← 이전":"← 上一步","이 목표로 시작하기":"從這個目標開始","오늘 완료함 ✓":"今天已完成 ✓","오늘 완료로 표시":"標記今天完成","최근 30일":"最近30天","이번 달 평균":"本月平均","이번 주":"本週","지난주":"上週","최근 4주 평균":"近4週平均","오늘":"今天"
    },
    ja: {
      "나의 생활 MBO":"私の生活MBO","오늘 뭘 채웠나요?":"今日は何を達成しましたか？","카테고리를 눌러서 기록해 보세요.":"カテゴリを選んで記録してみましょう。","나의 생활 그리드":"生活グリッド","전체 연도 요약":"全年度サマリー","낮음":"低","높음":"高","최근 12주":"直近12週間","🌿 나의 생활 회고 보기":"🌿 生活レビューを見る","← MBO 메인":"← MBOホーム","← 뒤로":"← 戻る","← 홈":"← ホーム","나의 목표":"私の目標","오늘 기록":"今日の記録","기록 모아보기 →":"記録をまとめて見る →","전체 기록":"全記録","날짜 선택해서 기록하기":"日付を選んで記録","저장":"保存","연간 기록":"年間記録","기록 없음":"記録なし","달성":"達成","미달성":"未達成","완료":"完了","월별 평균":"月別平均","생활 회고":"生活レビュー","한 해의 생활 그리드":"年間生活グリッド","목표별 돌아보기":"目標別レビュー","나의 서재":"私の本棚","100권 읽기 프로젝트":"100冊読書プロジェクト","지금까지":"これまで","완독":"読了","읽는 중":"読書中","총 독서시간":"総読書時間","나의 서재 들어가기 →":"本棚に入る →","📖 독서 회고 보기":"📖 読書レビューを見る","이번 주 목표":"今週の目標","연속 독서 · 출석 스티커":"連続読書・出席ステッカー","나의 책갈피":"私のしおり","뱃지":"バッジ","올해 독서 기록":"今年の読書記録","주간 독서 시간":"週間読書時間","(분)":"（分）","월별 완독 권수":"月別読了冊数","연도별 완독":"年別読了","장르별 권수":"ジャンル別冊数","전체":"すべて","읽고 싶음":"読みたい","시작 전":"開始前","중단":"中断","최근 업데이트순":"最近の更新順","진행률순":"進捗順","제목순":"タイトル順","그리드":"グリッド","보드":"ボード","회고":"レビュー","내보내기":"エクスポート","가져오기":"インポート","전체 공개":"すべて公開","전체 비공개":"すべて非公開","🔗 공유 링크":"🔗 共有リンク","독서 회고":"読書レビュー","새 책 추가":"新しい本を追加","검색":"検索","제목":"タイトル","저자":"著者","출판사":"出版社","옮긴이 (있다면)":"訳者（いる場合）","총 페이지 수":"総ページ数","상태":"状態","취소":"キャンセル","추가하기":"追加","공유 링크 만들기":"共有リンクを作成","친구에게 보여줄 이름":"友だちに表示する名前","공유 링크":"共有リンク","닫기":"閉じる","다시 만들기":"再作成","링크 복사":"リンクをコピー","큐티":"QT","일기":"日記","오늘의 생각":"今日の考え","아침운동":"朝の運動","저녁운동":"夜の運動","일찍 일어나기":"早起き","일찍 자기":"早寝","독서":"読書","습관":"習慣","목표를 아직 설정하지 않았어요":"まだ目標を設定していません","3단계로 목표 만들기 →":"3ステップで目標を作る →","무엇을 만들고 싶나요?":"どんな習慣を作りたいですか？","왜 이걸 하고 싶나요?":"なぜ続けたいですか？","현실적으로 얼마나 자주 할까요?":"現実的にどれくらいの頻度にしますか？","다음 →":"次へ →","← 이전":"← 前へ","이 목표로 시작하기":"この目標で始める","오늘 완료함 ✓":"今日は完了 ✓","오늘 완료로 표시":"今日を完了にする","최근 30일":"直近30日","이번 달 평균":"今月の平均","이번 주":"今週","지난주":"先週","최근 4주 평균":"直近4週間の平均","오늘":"今日"
    },
    es: {"나의 생활 MBO":"Mi MBO de vida","오늘 뭘 채웠나요?":"¿Qué completaste hoy?","나의 생활 그리드":"Mi cuadrícula de vida","나의 목표":"Mi objetivo","오늘 기록":"Registro de hoy","전체 기록":"Todos los registros","저장":"Guardar","생활 회고":"Revisión de vida","나의 서재":"Mi biblioteca","독서":"Lectura","큐티":"Tiempo devocional","일기":"Diario","오늘의 생각":"Pensamientos de hoy","아침운동":"Ejercicio matutino","저녁운동":"Ejercicio nocturno","일찍 일어나기":"Levantarse temprano","일찍 자기":"Dormir temprano","검색":"Buscar","제목":"Título","저자":"Autor","출판사":"Editorial","완료":"Completado","오늘":"Hoy","이번 주":"Esta semana","지난주":"Semana pasada","최근 30일":"Últimos 30 días"},
    fr: {"나의 생활 MBO":"Mon MBO de vie","오늘 뭘 채웠나요?":"Qu’avez-vous accompli aujourd’hui ?","나의 생활 그리드":"Ma grille de vie","나의 목표":"Mon objectif","오늘 기록":"Enregistrement du jour","전체 기록":"Tous les enregistrements","저장":"Enregistrer","생활 회고":"Bilan de vie","나의 서재":"Ma bibliothèque","독서":"Lecture","큐티":"Temps de méditation","일기":"Journal","오늘의 생각":"Pensées du jour","아침운동":"Sport du matin","저녁운동":"Sport du soir","일찍 일어나기":"Se lever tôt","일찍 자기":"Se coucher tôt","검색":"Rechercher","제목":"Titre","저자":"Auteur","출판사":"Éditeur","완료":"Terminé","오늘":"Aujourd’hui","이번 주":"Cette semaine","지난주":"Semaine dernière","최근 30일":"30 derniers jours"},
    de: {"나의 생활 MBO":"Mein Lebens-MBO","오늘 뭘 채웠나요?":"Was hast du heute geschafft?","나의 생활 그리드":"Mein Lebensraster","나의 목표":"Mein Ziel","오늘 기록":"Heutiger Eintrag","전체 기록":"Alle Einträge","저장":"Speichern","생활 회고":"Lebensrückblick","나의 서재":"Meine Bibliothek","독서":"Lesen","큐티":"Andachtszeit","일기":"Tagebuch","오늘의 생각":"Gedanken des Tages","아침운동":"Morgentraining","저녁운동":"Abendtraining","일찍 일어나기":"Früh aufstehen","일찍 자기":"Früh schlafen","검색":"Suchen","제목":"Titel","저자":"Autor","출판사":"Verlag","완료":"Erledigt","오늘":"Heute","이번 주":"Diese Woche","지난주":"Letzte Woche","최근 30일":"Letzte 30 Tage"},
    pt: {"나의 생활 MBO":"Meu MBO de vida","오늘 뭘 채웠나요?":"O que você completou hoje?","나의 생활 그리드":"Minha grade de vida","나의 목표":"Meu objetivo","오늘 기록":"Registro de hoje","전체 기록":"Todos os registros","저장":"Salvar","생활 회고":"Revisão da vida","나의 서재":"Minha biblioteca","독서":"Leitura","큐티":"Momento devocional","일기":"Diário","오늘의 생각":"Pensamentos de hoje","아침운동":"Exercício da manhã","저녁운동":"Exercício da noite","일찍 일어나기":"Acordar cedo","일찍 자기":"Dormir cedo","검색":"Pesquisar","제목":"Título","저자":"Autor","출판사":"Editora","완료":"Concluído","오늘":"Hoje","이번 주":"Esta semana","지난주":"Semana passada","최근 30일":"Últimos 30 dias"},
    ru: {"나의 생활 MBO":"Мой жизненный MBO","오늘 뭘 채웠나요?":"Что вы выполнили сегодня?","나의 생활 그리드":"Моя сетка жизни","나의 목표":"Моя цель","오늘 기록":"Запись за сегодня","전체 기록":"Все записи","저장":"Сохранить","생활 회고":"Обзор жизни","나의 서재":"Моя библиотека","독서":"Чтение","큐티":"Время размышления","일기":"Дневник","오늘의 생각":"Мысли дня","아침운동":"Утренняя тренировка","저녁운동":"Вечерняя тренировка","일찍 일어나기":"Рано вставать","일찍 자기":"Рано ложиться","검색":"Поиск","제목":"Название","저자":"Автор","출판사":"Издательство","완료":"Выполнено","오늘":"Сегодня","이번 주":"Эта неделя","지난주":"Прошлая неделя","최근 30일":"Последние 30 дней"},
    ar: {"나의 생활 MBO":"MBO لحياتي","오늘 뭘 채웠나요?":"ماذا أنجزت اليوم؟","나의 생활 그리드":"شبكة حياتي","나의 목표":"هدفي","오늘 기록":"سجل اليوم","전체 기록":"كل السجلات","저장":"حفظ","생활 회고":"مراجعة الحياة","나의 서재":"مكتبتي","독서":"القراءة","큐티":"وقت التأمل","일기":"اليوميات","오늘의 생각":"أفكار اليوم","아침운동":"تمرين الصباح","저녁운동":"تمرين المساء","일찍 일어나기":"الاستيقاظ مبكرًا","일찍 자기":"النوم مبكرًا","검색":"بحث","제목":"العنوان","저자":"المؤلف","출판사":"الناشر","완료":"مكتمل","오늘":"اليوم","이번 주":"هذا الأسبوع","지난주":"الأسبوع الماضي","최근 30일":"آخر 30 يومًا"},
    hi: {"나의 생활 MBO":"मेरा जीवन MBO","오늘 뭘 채웠나요?":"आज आपने क्या पूरा किया?","나의 생활 그리드":"मेरा जीवन ग्रिड","나의 목표":"मेरा लक्ष्य","오늘 기록":"आज का रिकॉर्ड","전체 기록":"सभी रिकॉर्ड","저장":"सहेजें","생활 회고":"जीवन समीक्षा","나의 서재":"मेरी लाइब्रेरी","독서":"पढ़ना","큐티":"ध्यान का समय","일기":"डायरी","오늘의 생각":"आज के विचार","아침운동":"सुबह का व्यायाम","저녁운동":"शाम का व्यायाम","일찍 일어나기":"जल्दी उठना","일찍 자기":"जल्दी सोना","검색":"खोजें","제목":"शीर्षक","저자":"लेखक","출판사":"प्रकाशक","완료":"पूर्ण","오늘":"आज","이번 주":"इस सप्ताह","지난주":"पिछला सप्ताह","최근 30일":"पिछले 30 दिन"},
    id: {"나의 생활 MBO":"MBO Hidup Saya","오늘 뭘 채웠나요?":"Apa yang kamu selesaikan hari ini?","나의 생활 그리드":"Grid Hidup Saya","나의 목표":"Tujuan saya","오늘 기록":"Catatan hari ini","전체 기록":"Semua catatan","저장":"Simpan","생활 회고":"Tinjauan hidup","나의 서재":"Perpustakaan saya","독서":"Membaca","일기":"Jurnal","오늘의 생각":"Pikiran hari ini","아침운동":"Olahraga pagi","저녁운동":"Olahraga malam","일찍 일어나기":"Bangun pagi","일찍 자기":"Tidur lebih awal","검색":"Cari","제목":"Judul","저자":"Penulis","출판사":"Penerbit","완료":"Selesai","오늘":"Hari ini","이번 주":"Minggu ini","지난주":"Minggu lalu","최근 30일":"30 hari terakhir"},
    vi: {"나의 생활 MBO":"MBO Cuộc sống của tôi","오늘 뭘 채웠나요?":"Hôm nay bạn đã hoàn thành gì?","나의 생활 그리드":"Lưới cuộc sống","나의 목표":"Mục tiêu của tôi","오늘 기록":"Ghi chép hôm nay","전체 기록":"Tất cả ghi chép","저장":"Lưu","생활 회고":"Nhìn lại cuộc sống","나의 서재":"Thư viện của tôi","독서":"Đọc sách","일기":"Nhật ký","오늘의 생각":"Suy nghĩ hôm nay","아침운동":"Tập thể dục buổi sáng","저녁운동":"Tập thể dục buổi tối","일찍 일어나기":"Dậy sớm","일찍 자기":"Ngủ sớm","검색":"Tìm kiếm","제목":"Tiêu đề","저자":"Tác giả","출판사":"Nhà xuất bản","완료":"Hoàn thành","오늘":"Hôm nay","이번 주":"Tuần này","지난주":"Tuần trước","최근 30일":"30 ngày gần đây"},
    th: {"나의 생활 MBO":"MBO ชีวิตของฉัน","오늘 뭘 채웠나요?":"วันนี้คุณทำอะไรสำเร็จบ้าง?","나의 생활 그리드":"กริดชีวิตของฉัน","나의 목표":"เป้าหมายของฉัน","오늘 기록":"บันทึกวันนี้","전체 기록":"บันทึกทั้งหมด","저장":"บันทึก","생활 회고":"ทบทวนชีวิต","나의 서재":"ห้องสมุดของฉัน","독서":"อ่านหนังสือ","일기":"ไดอารี","오늘의 생각":"ความคิดวันนี้","아침운동":"ออกกำลังกายตอนเช้า","저녁운동":"ออกกำลังกายตอนเย็น","일찍 일어나기":"ตื่นเช้า","일찍 자기":"นอนเร็ว","검색":"ค้นหา","제목":"ชื่อเรื่อง","저자":"ผู้เขียน","출판사":"สำนักพิมพ์","완료":"เสร็จแล้ว","오늘":"วันนี้","이번 주":"สัปดาห์นี้","지난주":"สัปดาห์ที่แล้ว","최근 30일":"30 วันที่ผ่านมา"}
  };

  const DYNAMIC = {
    en: [
      [/^총\s*(\d+)권$/, (_,n)=>`Total ${n} books`],
      [/^(\d+)일 연속$/, (_,n)=>`${n}-day streak`],
      [/^(\d+)일 연속 하고 있어요$/, (_,n)=>`${n}-day streak`],
      [/^오늘\s*(\d+)\/(\d+)\s*·\s*(\d+)%$/, (_,a,b,r)=>`Today ${a}/${b} · ${r}%`],
      [/^(\d+)년 나의 생활 그리드$/, (_,y)=>`My Life Grid · ${y}`],
      [/^(\d+)년 전체 기록$/, (_,y)=>`${y} full record`],
      [/^(\d+)년$/, (_,y)=>`${y}`],
      [/^(\d+)월$/, (_,m)=>`Month ${m}`],
      [/^평균\s*(\d+)%$/, (_,n)=>`Average ${n}%`],
      [/^중앙값\s*(\d+)%$/, (_,n)=>`Median ${n}%`],
      [/^최근 30일\s*(\d+)%$/, (_,n)=>`Last 30 days ${n}%`],
      [/^주\s*(\d+)회 목표$/, (_,n)=>`${n}×/week goal`],
      [/^(\d+)회\/주$/, (_,n)=>`${n}/week`],
      [/^목표 대비\s*(\d+)%$/, (_,n)=>`${n}% of goal`],
      [/^(\d+)권 기록 중$/, (_,n)=>`${n} books`],
      [/^목표까지\s*(\d+)권 남았어요 \(목표\s*(\d+)권\)$/, (_,a,b)=>`${a} books left (goal ${b})`],
      [/^(\d+)일 달성$/, (_,n)=>`${n} days achieved`],
      [/^(\d+)분$/, (_,n)=>`${n} min`],
      [/^(\d+)시간\s*(\d+)분$/, (_,h,m)=>`${h}h ${m}m`]
    ],
    "zh-CN": [[/^총\s*(\d+)권$/,(_,n)=>`共 ${n} 本`],[/^(\d+)일 연속$/,(_,n)=>`连续 ${n} 天`],[/^오늘\s*(\d+)\/(\d+)\s*·\s*(\d+)%$/,(_,a,b,r)=>`今天 ${a}/${b} · ${r}%`],[/^(\d+)년 나의 생활 그리드$/,(_,y)=>`${y}年 我的生活网格`],[/^(\d+)년$/,(_,y)=>`${y}年`],[/^(\d+)월$/,(_,m)=>`${m}月`],[/^평균\s*(\d+)%$/,(_,n)=>`平均 ${n}%`],[/^주\s*(\d+)회 목표$/,(_,n)=>`每周 ${n} 次目标`],[/^(\d+)분$/,(_,n)=>`${n} 分钟`]],
    "zh-TW": [[/^총\s*(\d+)권$/,(_,n)=>`共 ${n} 本`],[/^(\d+)일 연속$/,(_,n)=>`連續 ${n} 天`],[/^오늘\s*(\d+)\/(\d+)\s*·\s*(\d+)%$/,(_,a,b,r)=>`今天 ${a}/${b} · ${r}%`],[/^(\d+)년 나의 생활 그리드$/,(_,y)=>`${y}年 我的生活網格`],[/^(\d+)년$/,(_,y)=>`${y}年`],[/^(\d+)월$/,(_,m)=>`${m}月`],[/^평균\s*(\d+)%$/,(_,n)=>`平均 ${n}%`],[/^주\s*(\d+)회 목표$/,(_,n)=>`每週 ${n} 次目標`],[/^(\d+)분$/,(_,n)=>`${n} 分鐘`]],
    ja: [[/^총\s*(\d+)권$/,(_,n)=>`合計 ${n}冊`],[/^(\d+)일 연속$/,(_,n)=>`${n}日連続`],[/^오늘\s*(\d+)\/(\d+)\s*·\s*(\d+)%$/,(_,a,b,r)=>`今日 ${a}/${b} · ${r}%`],[/^(\d+)년 나의 생활 그리드$/,(_,y)=>`${y}年 生活グリッド`],[/^(\d+)년$/,(_,y)=>`${y}年`],[/^(\d+)월$/,(_,m)=>`${m}月`],[/^평균\s*(\d+)%$/,(_,n)=>`平均 ${n}%`],[/^주\s*(\d+)회 목표$/,(_,n)=>`週${n}回の目標`],[/^(\d+)분$/,(_,n)=>`${n}分`]]
  };

  const ATTR_EN = {
    "제목·저자 검색":"Search title or author",
    "예: 아몬드 손원평":"e.g. Almond by Sohn Won-pyung",
    "예: 빈나의 서재":"e.g. Binna's Library",
    "입력해 주세요":"Enter text",
    "있다면 입력":"Enter if applicable",
    "예: 에세이, 소설, 자기계발":"e.g. essay, novel, self-development",
    "마음에 남은 문구를 적어보세요":"Write a quote you want to remember",
    "다 읽고 나서, 혹은 읽는 중간에도 생각을 남겨보세요.":"Write your thoughts after finishing or while reading.",
    "배운 점이나 써먹고 싶은 점을 한 줄로 적어보세요":"Write one thing you learned or want to use",
    "오늘 기록을 남겨보세요":"Write today's note"
  };

  const originalText = new WeakMap();
  const lastText = new WeakMap();
  const originalAttrs = new WeakMap();
  const lastAttrs = new WeakMap();
  let currentLang = localStorage.getItem(LANGUAGE_KEY) || "ko";
  if(!LANGUAGES.some(x=>x.code===currentLang)) currentLang = "ko";
  let observer = null;
  let translating = false;

  function pack(lang=currentLang){ return PACKS[lang] || {}; }
  function exactTranslate(text, lang=currentLang){
    if(lang === "ko") return text;
    const own = pack(lang)[text];
    if(own != null) return own;
    const english = EN[text];
    return english != null ? english : text;
  }
  function dynamicTranslate(text, lang=currentLang){
    if(lang === "ko") return text;
    const rules = DYNAMIC[lang] || DYNAMIC.en || [];
    for(const [re,fn] of rules){ if(re.test(text)) return text.replace(re, (...args)=>fn(...args)); }
    if(lang !== "en"){
      for(const [re,fn] of DYNAMIC.en){ if(re.test(text)) return text.replace(re, (...args)=>fn(...args)); }
    }
    return text;
  }
  function translateCore(text, lang=currentLang){
    if(!text || lang === "ko") return text;
    const exact = exactTranslate(text,lang);
    return exact !== text ? exact : dynamicTranslate(text,lang);
  }
  function preserveWhitespace(source, translated){
    const lead = (source.match(/^\s*/) || [""])[0];
    const trail = (source.match(/\s*$/) || [""])[0];
    return lead + translated + trail;
  }
  function shouldSkip(el){
    if(!el) return true;
    return !!el.closest("script,style,textarea,[contenteditable='true'],[data-i18n-ignore='true']");
  }
  function translateTextNode(node, force=false){
    const parent = node.parentElement;
    if(!parent || shouldSkip(parent)) return;
    const now = node.nodeValue || "";
    if(!now.trim()) return;
    const prevLast = lastText.get(node);
    if(!originalText.has(node) || (!force && prevLast != null && now !== prevLast)) originalText.set(node, now);
    const src = originalText.get(node) || now;
    const trimmed = src.trim();
    const outCore = translateCore(trimmed,currentLang);
    const out = preserveWhitespace(src,outCore);
    if(now !== out){ node.nodeValue = out; }
    lastText.set(node,out);
  }
  function translateAttrs(el, force=false){
    if(shouldSkip(el)) return;
    const attrs = ["placeholder","title","aria-label"];
    let originals = originalAttrs.get(el) || {};
    let lasts = lastAttrs.get(el) || {};
    for(const attr of attrs){
      if(!el.hasAttribute || !el.hasAttribute(attr)) continue;
      const now = el.getAttribute(attr) || "";
      if(!originals[attr] || (!force && lasts[attr] != null && now !== lasts[attr])) originals[attr] = now;
      const src = originals[attr] || now;
      const trimmed = src.trim();
      let out = translateCore(trimmed,currentLang);
      if(out === trimmed && currentLang !== "ko") out = (pack(currentLang)[trimmed] || ATTR_EN[trimmed] || EN[trimmed] || trimmed);
      if(now !== out) el.setAttribute(attr,out);
      lasts[attr] = out;
    }
    originalAttrs.set(el, originals); lastAttrs.set(el,lasts);
  }
  function translateDom(root=document, force=false){
    if(translating) return;
    translating = true;
    try{
      const walker = document.createTreeWalker(root.nodeType===Node.DOCUMENT_NODE?root.documentElement:root, NodeFilter.SHOW_TEXT);
      const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(n=>translateTextNode(n,force));
      const base = root.nodeType===Node.ELEMENT_NODE ? root : document;
      if(base.matches) translateAttrs(base,force);
      if(base.querySelectorAll) base.querySelectorAll("[placeholder],[title],[aria-label]").forEach(el=>translateAttrs(el,force));
      document.title = currentLang === "ko" ? "나의 생활 MBO · 나의 서재" : (exactTranslate("나의 생활 MBO",currentLang) + " · " + exactTranslate("나의 서재",currentLang));
    } finally { translating = false; }
  }
  function setLanguage(code){
    if(!LANGUAGES.some(x=>x.code===code)) code="ko";
    currentLang=code; localStorage.setItem(LANGUAGE_KEY,code);
    const info=LANGUAGES.find(x=>x.code===code) || LANGUAGES[0];
    document.documentElement.lang=code; document.documentElement.dir=info.dir;
    const sel=document.getElementById("globalLanguageSelect"); if(sel && sel.value!==code) sel.value=code;
    translateDom(document,true);
    window.dispatchEvent(new CustomEvent("mbo-language-change",{detail:{language:code}}));
  }
  function initSelector(){
    const sel=document.getElementById("globalLanguageSelect"); if(!sel) return;
    sel.innerHTML=LANGUAGES.map(x=>`<option value="${x.code}">${x.label}</option>`).join("");
    sel.value=currentLang;
    sel.addEventListener("change",()=>setLanguage(sel.value));
    const info=LANGUAGES.find(x=>x.code===currentLang) || LANGUAGES[0];
    document.documentElement.lang=currentLang; document.documentElement.dir=info.dir;
  }
  function initObserver(){
    if(observer) observer.disconnect();
    observer=new MutationObserver(mutations=>{
      if(translating) return;
      for(const m of mutations){
        if(m.type==="characterData") translateTextNode(m.target,false);
        else if(m.type==="attributes") translateAttrs(m.target,false);
        else for(const n of m.addedNodes){
          if(n.nodeType===Node.TEXT_NODE) translateTextNode(n,false);
          else if(n.nodeType===Node.ELEMENT_NODE) translateDom(n,false);
        }
      }
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["placeholder","title","aria-label"]});
  }
  function init(){ initSelector(); translateDom(document,true); initObserver(); }

  window.I18N = { LANGUAGES, setLanguage, getLanguage:()=>currentLang, translateDom, translateText:(s)=>translateCore(s,currentLang) };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
