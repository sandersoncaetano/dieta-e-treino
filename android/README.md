# Dieta e Treino Sync (Android)

App pequeno que lê o Health Connect (peso, composição corporal, sono, FC de repouso, passos)
e envia para `/api/saude` do Dieta e Treino. Compilado pelo GitHub Actions
(`.github/workflows/android.yml`); cada compilação vira uma versão em Releases.
A assinatura usa `android/release.p12`, protegida pelo segredo `ANDROID_KEYSTORE_PASSWORD`.
