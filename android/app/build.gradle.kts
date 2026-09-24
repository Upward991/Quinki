plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.quinki.app"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        targetSdk = 35
        versionCode = 30
        versionName = "1.0.0-beta.23f"
    }

    flavorDimensions += "role"
    productFlavors {
        create("quinki") {
            dimension = "role"
            applicationId = "com.quinki.app"
            resValue("string", "app_name", "Quinki")
            resValue("string", "ua_marker", "QuinkiApp/1.0")
        }
        create("expert") {
            dimension = "role"
            applicationId = "com.quinki.expert"
            resValue("string", "app_name", "App Expert")
            resValue("string", "ua_marker", "QuinkiAppExpert/1.0")
        }
    }

    signingConfigs {
        create("release") {
            storeFile = file("../keystore/quinki-release.keystore")
            storePassword = "quinki-release-2026"
            keyAlias = "quinki"
            keyPassword = "quinki-release-2026"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
