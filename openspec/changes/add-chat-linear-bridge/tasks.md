## 1. Sözleşmeler ve uyumluluk
- [ ] Claude, Gemini ve Codex ACP adaptörlerinde stdio MCP enjeksiyonunu ve permission kimliği davranışını spike ile doğrula; destek matrisini kaydet.
- [ ] Araç şemalarını, broker RPC sözleşmesini, session capability kapsamını ve olay redaction kurallarını tanımla.
- [ ] Repo readonly ile izinli servis yazmalarının ayrımını project.md ve kullanıcı belgelerinde netleştir.

## 2. Linear servis katmanı
- [ ] Mevcut polling davranışını koruyarak ortak Linear istemcisini ayır; GraphQL hataları, pagination ve rate limit davranışını tanımla.
- [ ] Workspace kapsamlı search/get/metadata/create/update/submit işlemlerini uygula; takım ve durum çözümlemesini doğrula.
- [ ] Taslak/teslim ayrımını, update conflict kontrolünü, issue kilidini ve mutation uzlaştırmasını uygula.

## 3. Yerel MCP köprüsü
- [ ] Güvenilir broker'ı ve paketlenmiş sidecar stdio MCP proxy modunu ekle; yalnızca tanımlı araçları aç.
- [ ] Tauri üzerinden mevcut Keychain erişimini broker'a bağla; chat/agent ortamına credential geçmesini engelle.
- [ ] Oturum bazlı workspace/capability doğrulaması, key yenileme/silme ve subprocess temizliğini uygula.
- [ ] ACP oturumuna MCP kaydını otomatik ekle; bağlantı yokken repo sohbetini kullanılabilir tut.

## 4. Sohbet deneyimi
- [ ] Preamble ve permission yönetimini repo salt okunurluğu ile Linear araçlarını birlikte destekleyecek şekilde güncelle.
- [ ] Mevcut workspace/turn skill seçimlerini koru; product-owner ile task hazırlama akışını doğrula.
- [ ] Task URL/identifier, gerçek durum, kuyruk uygunluğu ve actionable hata sonuçlarını tool kartlarında göster; queue'yu yenile.

## 5. Doğrulama
- [ ] Sahte Linear ile araç şeması, kapsam, takım seçimi, pagination, GraphQL hata ve timeout testlerini çalıştır.
- [ ] Secret isolation, sahte/eski capability, kapalı workspace, concurrent chat ve lifecycle testlerini çalıştır.
- [ ] Daemon intake yarışı, In Progress edit reddi ve retry sırasında duplicate create davranışını test et.
- [ ] Mevcut pytest ve UI vitest kontrollerini çalıştır; sidecar paketinde proxy modunu doğrula.
- [ ] Desteklenen her adaptörde create → edit → submit → mevcut loop intake uçtan uca akışını test hesabında doğrula; ek terminal/MCP config'i gerekmediğini kontrol et.
