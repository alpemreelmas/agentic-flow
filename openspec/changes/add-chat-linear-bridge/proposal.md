# Change: ACP Chat Linear Bridge

## Why
Uygulama içindeki ACP sohbeti fikir geliştirebiliyor ve skill kullanabiliyor ancak Linear task'larını oluşturamıyor veya düzenleyemiyor. Kullanıcı mevcut Linear bağlantısını tekrar agent CLI/MCP ayarlarına taşımadan sohbetten iş hazırlamak istiyor. Hazırlanan işleri mevcut otonom loop uygulamaya devam edecek.

## What Changes
- Uygulamanın yönettiği, sohbet oturumuna bağlı yerel MCP köprüsü; ilk sağlayıcı Linear.
- Mevcut Keychain bağlantısıyla task arama, okuma, oluşturma ve düzenleme; agent'a servis token'ı verilmez.
- Task hazırlama ile otonom kuyruğa teslim etme ayrı araç işlemleri olur; teslim mevcut yapılandırmadaki ready durumunu ve agent etiketini kullanır.
- Sohbet repo üzerinde salt okunur kalırken izin verilen Linear yazma araçlarını kullanabilir.
- Mevcut workspace/turn skill seçimi korunur; varsa product-owner skill'i task hazırlığında kullanılabilir.
- Araç sonuçları, task bağlantıları ve bağlantı hataları sohbetten görünür olur.

## Scope & Assumptions
- İlk sürüm yalnızca uygulama içindeki ACP sohbetleri ve Linear içindir; GitHub MCP araçları, dış MCP istemcileri, knowledgebase ve OAuth geçişi kapsam dışıdır.
- Yeni bir görev yürütücüsü veya kuyruk eklenmez; Todo + agent varsayılanları ve In Progress üzerinden resume korunur.
- Kullanıcının konuşmadaki açık task oluşturma/düzenleme/teslim talebi yetkilendirmedir; her işlem için tekrar onay akışı eklenmez.
- Task oluşturma kendiliğinden kuyruğa teslim sayılmaz; kullanıcı açıkça teslim istediyse aynı konuşma turunda teslim edilebilir.
- Workspace'in Linear projesi bağlı değilse sohbet çalışır, Linear araçları açıklayıcı kurulum bilgisi verir; proje tahmin edilmez.
- Mevcut add-shared-project-memory önerisinden bağımsız uygulanır; ortak bir uzak servis gerektirmez.

## Impact
- Yeni specs: chat-linear-tools, chat-tool-bridge.
- Etkilenen alanlar: Python ACP/chat/CLI, Linear istemcisi, Tauri sohbet ve credential yaşam döngüsü, sohbet UI olayları, sidecar paketleme ve testler.
- Mevcut project.md içindeki chat read-only ifadesi uygulamada repo salt okunurluğu olarak netleştirilecek; servis yazmaları harness üzerinden yapılacak.
- Başlıca riskler: agent adaptörlerinin MCP desteği, alt süreçlere credential sızıntısı ve loop'un aldığı bir task'ın sohbetten değiştirilmesi.
