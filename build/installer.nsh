!macro customInstall
  SetOutPath "$INSTDIR"
  File "${PROJECT_DIR}\node_modules\electron\dist\snapshot_blob.bin"
  File "${PROJECT_DIR}\node_modules\electron\dist\v8_context_snapshot.bin"
!macroend
