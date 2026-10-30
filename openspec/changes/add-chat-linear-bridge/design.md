# Design

## Mevcut altyapı
- looper/chat.py seçilen skill içeriklerini prompt'a ekler, readonly policy kullanır ve new_session çağrısına boş mcp_servers gönderir.
- looper/sources.py LinearSource ready/progress durumlarındaki etiketli işleri okur; oluşturma ve genel düzenleme API'si yoktur.
- looper/main.py proje-workspace eşlemesiyle işleri worktree içinde çalıştırır; yeni kuyruk gerekmiyor.
- Tauri config.rs Linear anahtarını Keychain'de tutar; webview anahtarı okuyamaz.
- GitHub teslimi gh üzerinden yapılır; bunu yeni bir genel GitHub bağlantısı olarak varsaymayız.

## Technical Development Notes

### Mimari ve yaşam döngüsü
Tauri chat başlatırken kayıtlı workspace kimliğini doğrular ve sohbet için yerel bridge broker başlatır. Broker yalnızca loopback üzerinde dinler, rastgele port ve oturuma özel geçici capability kullanır. Python sidecar'a eklenen stdio MCP proxy modu, ACP new_session mcp_servers kaydına uygulama tarafından otomatik geçirilir; proxy Linear anahtarını taşımaz. Bu yaklaşım agent adaptörlerinin stdio MCP desteğini kullanır; uygulama endpoint'ini veya proxy'yi kullanıcı kurmaz.

Broker ayrı bir güvenilir süreç olarak Linear anahtarını alır; chat sidecar ve agent alt süreçlerinin environment'ından LINEAR_API_KEY ve bridge dışındaki gereksiz credential değişkenleri çıkarılır. Broker RPC yalnızca tanımlı araçları kabul eder; genel HTTP/GraphQL veya shell geçidi sunmaz. Proxy capability'si workspace, oturum ve izin verilen araçlarla sınırlıdır. Süreç argümanları, olaylar ve hata logları Linear anahtarını içermez.

Sohbet kapanınca broker/proxy sonlandırılır ve capability geçersizleşir. Agent hatasında temizlik yapılır; loop'un süreçleri etkilenmez. Key silinirse yeni tool çağrıları reddedilir; key değişikliği broker bağlantısının uygulama tarafından yenilenmesiyle etkili olur. Araçlar kullanılamadığında repo sohbeti kullanılabilir kalır.

### Linear araçları
- linear_search_issues: bağlı proje içinde sayfalı arama/listeleme; agent etiketi olmayan taslakları da bulur.
- linear_get_issue: kimlik veya identifier ile getirir, proje sınırını sunucu tarafında doğrular.
- linear_get_metadata: bağlı projenin takımlarını, takıma ait durumları ve kullanılabilir etiketleri getirir; çoklu takımda yazma için açık team seçimi gerekir.
- linear_create_issue: title/description ve geçerli takım bilgisiyle bağlı projede oluşturur; varsayılan taslak durumu yapılandırılmış blocked durumudur ve loop etiketi otomatik eklenmez.
- linear_update_issue: title/description ve loop'a teslim etmeyen metadata değişiklikleri; çalışan task güncellemesini reddeder.
- linear_submit_issue: açık teslim talebiyle yapılandırılmış ready durumunu ve loop etiketini birlikte uygular; zaten teslim edilmişse tekrar etkisiz sonuç döndürür.

Genel update/create araçları ready/progress + loop etiketi bileşimini oluşturamaz; teslim yalnızca submit aracından geçer. Kullanıcının doğal dildeki talebi agent tarafından yorumlanır; sunucu açık submit tool çağrısını sınır olarak uygular, niyeti kendi başına sınıflandırmaz. Yanıt identifier, URL, gerçek son durum ve kuyruğa uygunluğu içerir. Submit daemon'u başlatmaz ve görevin anında çalışacağını vaat etmez.

Mevcut Linear taşıma katmanı reusable istemciye ayrılır; polling ve bridge aynı hata/GraphQL davranışını kullanır. Project/takım/etiket ilişkileri doğrulanır; mevcut tek-workspace catch-all davranışı sohbet yazmalarında proje tahminine dönüştürülmez.

### Yetkiler ve eşzamanlılık
Repo read/edit/execute politikası ile servis araç yetkileri ayrılır. Bir MCP tool'un yalnızca read kind bildirmesi yazma yetkisi vermez; güvenilir bridge'deki araç adı ve session kapsamı belirleyicidir. Diğer MCP sunucuları bu istisnayı kazanmaz. ACP adaptörünün permission olayları araç kimliğini güvenilir biçimde ayıramıyorsa desteği doğrulanana kadar bridge yazması kapalı kalır; genel execute izni açılmaz.

Yazma öncesi issue tekrar okunur; In Progress işleri değiştirilemez ve gözlenen updatedAt değişmişse kullanıcıya güncel içerik gösterilir. Sohbetten yapılacak submit/update ile daemon intake arasındaki yerel yarış için aynı issue üzerinde ortak kilit kullanılır; kilit altında durum tekrar doğrulanır. Harici Linear değişikliklerinde mutlak atomiklik vaat edilmez. Belirsiz mutation timeout'unda kör tekrar yapılmaz: create için uygulama request-id/sonuç kaydı tutulur ve uzlaştırma sonucu belirsizse kullanıcıya söylenir; update/submit son durumu tekrar okunur.

### Skill ve arayüz
Var olan skill keşfi ve seçimleri kullanılır; product-owner zorunlu bağımlılık veya gömülü task şablonu olmaz. Preamble, izin verilen Linear araçlarını ve hazırlama/teslim farkını anlatır. Sohbet araç kartları başarılı işlemin task bağlantısını gösterir; başarısız çağrı başarı gibi sunulmaz. Queue mevcut kaynaktan yenilenir; ayrı task deposu eklenmez.

### Gelecek genişlemeler
Araç kayıtları sağlayıcı adı ve capability kapsamı taşır. GitHub veya memory daha sonra aynı broker sınırına eklenebilir; bu değişiklikte onların tool sözleşmeleri ve credential akışları uygulanmaz. Shared-memory önerisinin repo readonly sözleşmesiyle uyum korunur.

## Testing & Edge Cases
| Edge Case | Developer Note | Tester Note |
|---|---|---|
| Credential sızıntısı | Anahtarı yalnızca güvenilir broker'a ver ve alt süreç ortamını temizle. | Agent/proxy env, argv ve event loglarında Linear anahtarı olmadığını doğrula. |
| Workspace dışı issue | Kimlikten bağımsız proje kontrolünü her araçta uygula. | Başka projedeki identifier ile okuma ve yazmanın reddedildiğini doğrula. |
| Hazırlık ve teslim | Kuyruğa uygun kombinasyonu yalnızca submit oluşturabilsin. | Create/update ile örtük teslimin engellendiğini ve submit'in mevcut loop tarafından alındığını doğrula. |
| Eşzamanlı değişiklik | Intake ve bridge yazmalarını ortak issue kilidiyle koordine et. | Loop işi alırken sohbet güncellemesinin çalışan task'ı değiştirmediğini doğrula. |
| Belirsiz timeout | Mutation tekrarından önce kayıt ve uzak durumu uzlaştır. | Yanıtı kaybolan create tekrarında ikinci issue oluşmadığını veya belirsizliğin açık gösterildiğini doğrula. |
| Adaptör uyumsuzluğu | Yetki sınırını zayıflatmadan capability hatası döndür. | Claude/Gemini/Codex adaptörlerinde destek veya açık devre dışı durumunu doğrula. |
| Bağlantı kapatma | Oturum capability'sini ve alt süreçleri birlikte kapat. | Kapanan sohbetin capability'siyle yeni çağrının başarısız olduğunu doğrula. |
