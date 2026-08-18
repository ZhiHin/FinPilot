import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy notice · Notis privasi" };

const UPDATED = "18 August 2026";

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mt-6 text-[15px] font-semibold text-ink">
      {children}
    </h3>
  );
}

/**
 * Public PDPA-oriented privacy notice in English and Bahasa Melayu (risk doc
 * §1 / launch checklist). Reachable without an account. The two language
 * versions carry the same commitments; content mirrors what the app actually
 * does — no aspirational claims.
 */
export default function PrivacyNoticePage() {
  return (
    <div className="min-h-dvh bg-page px-4 py-10">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        <p className="text-[13px] text-ink-secondary">
          <Link href="/" className="text-accent underline underline-offset-2 hover:no-underline">
            FinPilot
          </Link>
        </p>
        <h1 className="text-[24px] font-semibold text-ink">Privacy notice · Notis privasi</h1>
        <p className="text-[13px] text-ink-secondary">
          Last updated · Kemas kini terakhir: {UPDATED}
        </p>
        <nav aria-label="Language" className="mt-2 flex gap-3 text-[13px]">
          <a
            href="#english"
            className="text-accent underline underline-offset-2 hover:no-underline"
          >
            English
          </a>
          <a href="#melayu" className="text-accent underline underline-offset-2 hover:no-underline">
            Bahasa Melayu
          </a>
        </nav>

        <section
          id="english"
          aria-labelledby="english-heading"
          className="mt-6 rounded-card border border-hairline bg-card p-6 text-[13.5px] leading-6 text-ink-secondary sm:p-8"
        >
          <h2 id="english-heading" className="text-[19px] font-semibold text-ink">
            English
          </h2>
          <p className="mt-3">
            FinPilot is a personal-finance tool for users in Malaysia. This notice explains, in
            plain language, what personal data FinPilot processes and the choices you have. It is
            written to follow the principles of the Personal Data Protection Act 2010 (PDPA),
            including the 2024 amendments.
          </p>

          <SectionHeading id="en-collect">What we collect</SectionHeading>
          <p>
            Your email address, a password (stored only as a modern one-way hash), an optional
            display name, your preferences, and the financial records you enter or import: accounts,
            transactions, budgets, goals, recurring payments, scenarios, and journal notes. We
            deliberately do not collect your national ID, phone number, home address, or date of
            birth. Your IP address is stored only as a salted hash, used for sign-in rate limiting
            and the security audit trail.
          </p>

          <SectionHeading id="en-purpose">Why we process it</SectionHeading>
          <p>
            Solely to provide FinPilot to you: showing your balances and history, computing budgets,
            forecasts, and insights, and securing your account. We do not sell your data, we do not
            show ads, and we do not use your data to train AI models.
          </p>

          <SectionHeading id="en-ai">Generative AI is separate and optional</SectionHeading>
          <p>
            All core features run on deterministic calculations on our own servers. Two optional
            features (insight phrasing and the assistant) can call an external AI provider — only
            after you give explicit, separate consent in Settings, and never while Privacy Mode is
            on. What is sent is minimized (pre-aggregated totals and verified figures, never raw
            transaction tables or account numbers). You can withdraw consent at any time.
          </p>

          <SectionHeading id="en-disclosure">Disclosure</SectionHeading>
          <p>
            No third parties receive your data except the infrastructure that hosts the service and,
            if you opted in, the configured AI provider as described above. There is no other
            disclosure, sale, or sharing.
          </p>

          <SectionHeading id="en-security">Security</SectionHeading>
          <p>
            Passwords are hashed with Argon2id; sessions are opaque, revocable tokens; all traffic
            is TLS-only in production; every security-relevant action is recorded in an audit trail;
            operational logs never contain amounts, descriptions, or credentials.
          </p>

          <SectionHeading id="en-retention">Retention and deletion</SectionHeading>
          <p>
            Your data stays until you delete it. Uploaded statement files are discarded after import
            — only the rows you confirmed are kept. Account deletion is staged: immediate
            deactivation, a 30-day recovery window, then a permanent purge of every record you own.
            The purge itself is recorded without your personal details.
          </p>

          <SectionHeading id="en-rights">Your rights</SectionHeading>
          <p>
            You can view and correct everything in-app, export a complete machine-readable copy of
            your data (Settings → Data), withdraw AI consent, and delete your account — all
            self-service, no request forms. Questions or complaints: contact the operator of your
            FinPilot deployment.
          </p>
        </section>

        <section
          id="melayu"
          aria-labelledby="melayu-heading"
          lang="ms"
          className="mt-6 rounded-card border border-hairline bg-card p-6 text-[13.5px] leading-6 text-ink-secondary sm:p-8"
        >
          <h2 id="melayu-heading" className="text-[19px] font-semibold text-ink">
            Bahasa Melayu
          </h2>
          <p className="mt-3">
            FinPilot ialah alat kewangan peribadi untuk pengguna di Malaysia. Notis ini menerangkan
            dengan bahasa mudah apakah data peribadi yang diproses oleh FinPilot dan pilihan yang
            anda ada. Ia ditulis mengikut prinsip Akta Perlindungan Data Peribadi 2010 (PDPA),
            termasuk pindaan 2024.
          </p>

          <SectionHeading id="ms-collect">Apa yang kami kumpul</SectionHeading>
          <p>
            Alamat e-mel anda, kata laluan (disimpan hanya sebagai cincangan sehala moden), nama
            paparan pilihan, tetapan anda, dan rekod kewangan yang anda masukkan atau import: akaun,
            transaksi, bajet, matlamat, bayaran berulang, senario, dan catatan jurnal. Kami sengaja
            tidak mengumpul nombor kad pengenalan, nombor telefon, alamat rumah, atau tarikh lahir
            anda. Alamat IP anda disimpan hanya sebagai cincangan bergaram, digunakan untuk had
            kadar log masuk dan jejak audit keselamatan.
          </p>

          <SectionHeading id="ms-purpose">Mengapa kami memprosesnya</SectionHeading>
          <p>
            Semata-mata untuk menyediakan FinPilot kepada anda: memaparkan baki dan sejarah anda,
            mengira bajet, ramalan, dan pandangan, serta melindungi akaun anda. Kami tidak menjual
            data anda, tidak memaparkan iklan, dan tidak menggunakan data anda untuk melatih model
            AI.
          </p>

          <SectionHeading id="ms-ai">AI generatif adalah berasingan dan pilihan</SectionHeading>
          <p>
            Semua ciri teras berjalan dengan pengiraan deterministik pada pelayan kami sendiri. Dua
            ciri pilihan (frasa pandangan dan pembantu) boleh memanggil penyedia AI luaran — hanya
            selepas anda memberi persetujuan nyata yang berasingan dalam Tetapan, dan tidak sekali-
            kali semasa Mod Privasi dihidupkan. Apa yang dihantar adalah diminimumkan (jumlah
            teragregat dan angka yang disahkan, bukan jadual transaksi mentah atau nombor akaun).
            Anda boleh menarik balik persetujuan pada bila-bila masa.
          </p>

          <SectionHeading id="ms-disclosure">Pendedahan</SectionHeading>
          <p>
            Tiada pihak ketiga menerima data anda kecuali infrastruktur yang menjadi hos
            perkhidmatan ini dan, jika anda memilih untuk menyertainya, penyedia AI yang
            dikonfigurasi seperti diterangkan di atas. Tiada pendedahan, penjualan, atau perkongsian
            lain.
          </p>

          <SectionHeading id="ms-security">Keselamatan</SectionHeading>
          <p>
            Kata laluan dicincang dengan Argon2id; sesi ialah token legap yang boleh dibatalkan;
            semua trafik adalah TLS sahaja dalam produksi; setiap tindakan berkaitan keselamatan
            direkodkan dalam jejak audit; log operasi tidak sekali-kali mengandungi jumlah wang,
            keterangan transaksi, atau kelayakan.
          </p>

          <SectionHeading id="ms-retention">Penyimpanan dan pemadaman</SectionHeading>
          <p>
            Data anda kekal sehingga anda memadamkannya. Fail penyata yang dimuat naik dibuang
            selepas import — hanya baris yang anda sahkan disimpan. Pemadaman akaun dilakukan
            berperingkat: penyahaktifan serta-merta, tempoh pemulihan 30 hari, kemudian pemadaman
            kekal setiap rekod milik anda. Pemadaman itu sendiri direkodkan tanpa butiran peribadi
            anda.
          </p>

          <SectionHeading id="ms-rights">Hak anda</SectionHeading>
          <p>
            Anda boleh melihat dan membetulkan segala-galanya dalam aplikasi, mengeksport salinan
            lengkap data anda yang boleh dibaca mesin (Tetapan → Data), menarik balik persetujuan
            AI, dan memadam akaun anda — semuanya layan diri, tanpa borang permohonan. Soalan atau
            aduan: hubungi pengendali pemasangan FinPilot anda.
          </p>
        </section>

        <p className="mt-4 text-[11.5px] text-ink-muted">
          This notice describes the engineering posture of this FinPilot deployment. It is not a
          certification of legal compliance; a legal review is required before public launch.
        </p>
      </main>
    </div>
  );
}
