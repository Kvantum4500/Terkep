// Fájl mentése (pl. GPX): böngészőben letöltés; a natív Android-appban a WebView nem
// kezeli a letöltést, ezért a fájl a gyorsítótárba kerül, és a rendszer megosztás-
// menüjével menthető vagy küldhető tovább (Drive, e-mail, másik túraapp…).

export function isNative(): boolean {
  return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}

export async function saveTextFile(name: string, text: string, mime: string): Promise<void> {
  if (isNative()) {
    const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const r = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })
    await Share.share({ title: name, url: r.uri, dialogTitle: 'Mentés vagy küldés' })
    return
  }
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
