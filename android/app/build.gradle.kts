plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val versao = (System.getenv("VERSAO") ?: "1").toInt()

android {
    namespace = "app.dietaetreino.sync"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.dietaetreino.sync"
        minSdk = 28
        targetSdk = 35
        versionCode = versao
        versionName = "1.0.$versao"
    }

    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("KEYSTORE_FILE") ?: "release.p12")
            storePassword = System.getenv("KEYSTORE_PASSWORD")
            keyAlias = "dietaetreino"
            keyPassword = System.getenv("KEYSTORE_PASSWORD")
            storeType = "pkcs12"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.health.connect:connect-client:1.1.0-alpha11")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
