const entries = {
  "shell.sessionMediaTitle": [
    "원본 파일 다시 연결",
    "Relink original files",
    "重新链接原始文件"
  ],
  "shell.sessionMediaNotice": [
    "이번 탭에서만 원본을 연결해 미리보기와 내보내기를 사용합니다. 브라우저 저장 복구나 저장은 수행하지 않습니다. 이름과 길이가 같아도 같은 원본임을 보장하지 않습니다.",
    "Relink originals for preview and export in this tab only. This does not repair or write browser storage. Matching names and durations do not prove file identity.",
    "仅在此标签页重新链接原始文件以预览和导出。此操作不会修复或写入浏览器存储。名称和时长相同并不能证明文件相同。"
  ],
  "shell.sessionMediaConfirmLabel": [
    "선택한 파일이 이 프로젝트의 원본임을 확인합니다.",
    "I confirm these are the original files for this project.",
    "我确认所选文件是此项目的原始文件。"
  ],
  "shell.sessionMediaConnect": [
    "이번 탭에 연결",
    "Connect for this tab",
    "连接到此标签页"
  ],
  "shell.sessionMediaVideoLabel": [
    "원본 영상",
    "Original video",
    "原始视频"
  ],
  "shell.sessionMediaAudioLabel": [
    "추가 오디오",
    "Added audio",
    "附加音频"
  ],
  "shell.sessionMediaSelected": [
    "파일을 선택했습니다. 원본 확인 후 연결하세요.",
    "File selected. Confirm the originals before connecting.",
    "已选择文件。请确认原始文件后连接。"
  ],
  "shell.sessionMediaChooseAll": [
    "필요한 원본 파일을 모두 선택하세요.",
    "Select all required original files.",
    "请选择所有必需的原始文件。"
  ],
  "shell.sessionMediaConnecting": [
    "원본 파일 확인 중…",
    "Checking original files…",
    "正在检查原始文件…"
  ],
  "shell.sessionMediaConnected": [
    "이번 탭에 연결했습니다. 브라우저 저장 오류는 아직 해결되지 않았습니다.",
    "Connected for this tab. The browser storage error is still unresolved.",
    "已连接到此标签页。浏览器存储错误仍未解决。"
  ],
  "shell.sessionMediaConfirmation": [
    "원본 파일 확인에 동의해 주세요.",
    "Confirm that these are the original files.",
    "请确认这些是原始文件。"
  ],
  "shell.sessionMediaUnavailable": [
    "복구 가능한 편집 설정에서만 원본을 다시 연결할 수 있습니다.",
    "Relinking requires valid recovered project settings.",
    "重新链接需要有效的已恢复项目设置。"
  ],
  "shell.sessionMediaBusy": [
    "다른 작업이 끝난 뒤 다시 연결하세요.",
    "Wait for the current operation before relinking.",
    "请等待当前操作完成后重新链接。"
  ],
  "shell.sessionMediaVideo": [
    "유효한 원본 영상 파일을 선택하세요.",
    "Select a valid original video file.",
    "请选择有效的原始视频文件。"
  ],
  "shell.sessionMediaAudio": [
    "유효한 추가 오디오 파일을 선택하세요.",
    "Select a valid added audio file.",
    "请选择有效的附加音频文件。"
  ],
  "shell.sessionMediaName": [
    "선택한 파일 이름이 프로젝트의 원본 이름과 다릅니다.",
    "The selected file name does not match the project original.",
    "所选文件名与项目原始文件不匹配。"
  ],
  "shell.sessionMediaDuration": [
    "선택한 영상 길이가 프로젝트 원본과 다릅니다.",
    "The selected video duration does not match the project original.",
    "所选视频时长与项目原始文件不匹配。"
  ],
  "shell.sessionMediaFailed": [
    "파일을 연결하지 못했습니다. 원본과 형식을 확인하고 다시 시도하세요.",
    "Could not connect the files. Check the originals and formats, then retry.",
    "无法连接文件。请检查原始文件和格式后重试。"
  ],
  "shell.sessionMediaCancelled": [
    "파일 연결을 취소했습니다.",
    "File connection cancelled.",
    "文件连接已取消。"
  ],
  "shell.sessionMediaStale": [
    "프로젝트가 변경되었습니다. 다시 열어 파일을 선택하세요.",
    "The project changed. Reopen this dialog and select the files again.",
    "项目已更改。请重新打开对话框并选择文件。"
  ]
};
export const messages = Object.fromEntries(['ko', 'en', 'zh-CN'].map((locale,index) => [locale, Object.fromEntries(Object.entries(entries).map(([key, values]) => [key, values[index]]))]));
