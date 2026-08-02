# Technical Issue Report: WhatsApp Bot Delivery Rejected (Error 463)

**Status:** Blocked by WhatsApp account restriction  
**Tanggal laporan:** 2 Agustus 2026  
**Sistem:** Node.js bot dengan `@whiskeysockets/baileys`, PM2, Google Compute Engine, Firestore auth store

## 1. Ringkasan Eksekutif

Bot menerima dan mengeksekusi command WhatsApp dengan benar, tetapi server WhatsApp menolak pesan balasan dengan error `463`. Ini bukan lagi kegagalan parsing command, routing JID `@lid`, Firestore, atau Signal E2EE.

Error `463` merupakan **reachout timelock / account restriction**: pembatasan pengiriman yang diterapkan oleh server WhatsApp. `sock.sendMessage()` tetap dapat selesai tanpa exception karena itu hanya membuktikan frame berhasil dikirim dari proses bot ke koneksi WebSocket; status akhir kemudian diterima sebagai ACK error.

## 2. Dampak

- User dapat mengirim command ke bot.
- Bot dapat membaca dan mengeksekusi command seperti `/status`.
- Balasan bot tidak terkirim ke user.
- Retrying, re-pairing, reset sesi, atau mengganti JID tidak akan mencabut restriction dan berisiko memperburuk sinyal anti-spam.

## 3. Bukti Teknis

Identitas telah disamarkan untuk keamanan.

```text
[BOT] Connected successfully as 62881080*****:14@s.whatsapp.net
[UPSERT] Event type: notify, messages count: 1
[MSG IN] From: 71903624*****@lid (fromMe: false) | Body: "/status"
[EXEC] Executing 'status' for target JID: 71903624*****@lid
[STATUS_CMD] Attempting sendMessage to JID: 71903624*****@lid
[MSG_UPDATE] Message ID 3EB0A08B1B271376C1322F to 71903624*****@lid:
update={"status":0,"messageStubParameters":["463"]}
[STATUS_CMD] sendMessage succeeded for 71903624*****@lid:
messageId=3EB0A08B1B271376C1322F
```

Interpretasi:

- `messages.upsert` dengan `notify`: pesan user benar-benar masuk ke bot.
- Command `/status` ditemukan dan dieksekusi.
- `sendMessage` menghasilkan message ID, tetapi `messages.update` berikutnya mengubah status menjadi `0` (`ERROR`).
- `messageStubParameters: ["463"]` adalah error yang berasal dari ACK server WhatsApp.

## 4. Perbaikan yang Sudah Dilakukan

1. **Dual instance dihapus**
   - Cloud Run lama yang sempat menyebabkan `connectionReplaced` / code `440` sudah dihapus.
   - Socket VM sekarang dapat terhubung stabil.

2. **JID LID diperbaiki**
   - Bot sekarang membalas hanya ke `msg.key.remoteJid` asli (`@lid`).
   - Dual-send ke JID LID dan phone-number JID dihentikan karena tidak valid sebagai strategi delivery dan menyulitkan diagnosis.

3. **Persistensi Signal key diperketat**
   - Error baca/tulis Firestore Signal key tidak lagi ditelan; error dipropagasikan.
   - Ini mencegah Baileys menganggap state E2EE tersimpan padahal commit Firestore gagal.

4. **Observabilitas delivery ditambahkan**
   - Listener `messages.update` mencatat status akhir dan kode ACK.
   - Listener receipt mencatat `receipt` yang benar.

## 5. Kesimpulan Akar Masalah

**Penyebab aktif:** pembatasan akun oleh WhatsApp (`463`), bukan bug command handler atau failure Firestore.

**Faktor risiko yang mungkin berkontribusi:**

- Baileys menggunakan protokol WhatsApp Web yang tidak disediakan sebagai API bot resmi.
- Bot mengirim balasan otomatis.
- Sebelumnya terjadi reconnect, dual instance, reset sesi, dan re-pairing berulang.
- Pola pengiriman/pairing dapat dinilai tidak biasa oleh sistem proteksi WhatsApp.

Korelasi ini kuat, tetapi kode `463` tidak menyatakan penyebab detailnya. Hanya WhatsApp yang dapat menentukan alasan dan durasi restriction untuk akun tersebut.

## 6. Batasan Penting

- Tidak ada opsi `sendMessage` seperti `useLid`, `quoted`, atau `additionalNodes` yang dapat melewati error `463`.
- Upgrade Baileys tidak mencabut restriction yang sudah aktif.
- Mengganti JID dari LID ke `@s.whatsapp.net` tidak menyelesaikan policy restriction.
- Tidak boleh melakukan retry agresif, re-pairing berulang, atau bypass restriction.

## 7. Tindakan Segera

1. Hentikan pengiriman otomatis dari bot sementara restriction masih terjadi.
2. Jangan reset sesi Firestore atau pair ulang tanpa alasan koneksi yang terukur.
3. Uji sangat terbatas dari aplikasi WhatsApp resmi akun bot ke user yang sama.
   - Jika manual juga gagal, restriction berlaku pada akun.
   - Jika manual berhasil tetapi bot tetap `463`, catat hasilnya untuk investigasi linked-device/policy lebih lanjut.
4. Ajukan peninjauan melalui aplikasi WhatsApp resmi bila tombol **Minta Peninjauan / Request a review** tersedia.
5. Bila tidak tersedia, hubungi kanal resmi WhatsApp dan sertakan nomor akun, waktu kejadian WIB, dan screenshot/log error `463`.

Contoh pesan peninjauan:

> Halo WhatsApp Support, nomor [nomor akun] tidak dapat mengirim balasan dan menerima error 463 sejak [tanggal dan waktu WIB]. Mohon tinjau status akun ini dan informasikan tindakan yang diperlukan. Terima kasih.

## 8. Rekomendasi Jangka Panjang

Untuk bot operasional, migrasikan outbound/inbound messaging ke **WhatsApp Business Platform / Cloud API** resmi. Jangan mengandalkan Baileys sebagai jalur produksi untuk automasi pesan karena WhatsApp melarang auto-messaging dan akses otomatis yang tidak diotorisasi dalam ketentuannya.

Setelah akun pulih, lakukan uji satu pesan pada satu user opt-in terlebih dahulu. Jangan mengaktifkan scheduler atau bulk send sampai delivery tervalidasi dan keputusan arsitektur resmi disetujui.

## 9. Referensi

- [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service/)
- [WhatsApp Contact](https://www.whatsapp.com/contact)
- [Baileys Releases](https://github.com/WhiskeySockets/Baileys/releases)
