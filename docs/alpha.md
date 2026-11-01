# Alpha kurulum notları

Alpha sürümü küçük bir grup içindir. Hata bulursanız **Ayarlar → Teşhis → Teşhisi kopyala** ile çıktıyı gönderin (sürüm, işletim sistemi, araç kontrolü ve son log satırları içerir; API anahtarı içermez).

## Ön koşullar (her iki platform)
- `git`, `gh` (`gh auth login` yapılmış), Node.js 20+ (`npx`).
- En az bir ajan CLI: `claude` veya `codex`, giriş yapılmış.
- Linear API anahtarı (Linear → Settings → Security & access → API).
- İlk açılışta **Genel Bakış** sayfasındaki *Kurulum kontrolü* eksikleri listeler.

## macOS (Apple Silicon)
Uygulama Apple tarafından imzalı/notarize değildir. İlk açılışta "doğrulanamadı" derse: uygulamaya sağ tık → **Aç**, ya da
`xattr -cr "/Applications/Linear Looper.app"`.

## Linux
- Yalnızca **AppImage** otomatik güncellenir (`.deb` elle kurulur, güncelleme denetimi uyarı verir).
- `chmod +x Linear*.AppImage`; AppImage için `libfuse2` gerekir (Ubuntu 22.04+: `sudo apt install libfuse2`).
- Anahtar sistem anahtarlığında saklanır: gnome-keyring veya KWallet çalışıyor olmalı, yoksa anahtar kaydedilemez ve uygulama bunu söyler.
- Pencere boş açılırsa uygulama zaten `WEBKIT_DISABLE_DMABUF_RENDERER=1` ile başlar; yine de boşsa teşhisi gönderin.

## İlk deneme
Kendi gerçek reponuzda değil, önce küçük bir deneme reposunda çalıştırın: workspace olarak onu ekleyin, Linear'da `agent` etiketli bir issue açıp **Todo**'ya alın. Ajanlar bu repoda branch açıp PR (`gh`) oluşturabilir.

## Güncelleme
Uygulama açılışta ve 6 saatte bir yeni sürüm arar. Kurmadan önce döngüyü durdurun ve sohbetleri kapatın. Sürüm yayınlanmamışsa veya çevrimdışıysanız küçük bir "denetlenemedi" notu görürsünüz; bu normaldir.

## Bilinen sınırlar
Yalnızca macOS arm64 ve Linux x64. Windows ve Intel Mac desteklenmez. Arayüz Türkçedir.
