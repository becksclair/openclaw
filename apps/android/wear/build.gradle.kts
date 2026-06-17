val androidStoreFile = providers.gradleProperty("OPENCLAW_ANDROID_STORE_FILE").orNull?.takeIf { it.isNotBlank() }
val androidStorePassword = providers.gradleProperty("OPENCLAW_ANDROID_STORE_PASSWORD").orNull?.takeIf { it.isNotBlank() }
val androidKeyAlias = providers.gradleProperty("OPENCLAW_ANDROID_KEY_ALIAS").orNull?.takeIf { it.isNotBlank() }
val androidKeyPassword = providers.gradleProperty("OPENCLAW_ANDROID_KEY_PASSWORD").orNull?.takeIf { it.isNotBlank() }
val resolvedAndroidStoreFile =
  androidStoreFile?.let { storeFilePath ->
    if (storeFilePath.startsWith("~/")) {
      "${System.getProperty("user.home")}/${storeFilePath.removePrefix("~/")}"
    } else {
      storeFilePath
    }
  }

val hasAndroidReleaseSigning =
  listOf(resolvedAndroidStoreFile, androidStorePassword, androidKeyAlias, androidKeyPassword).all { it != null }

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
  alias(libs.plugins.ktlint)
}

android {
  namespace = "ai.openclaw.wear"
  compileSdk = 36

  signingConfigs {
    if (hasAndroidReleaseSigning) {
      create("release") {
        storeFile = project.file(checkNotNull(resolvedAndroidStoreFile))
        storePassword = checkNotNull(androidStorePassword)
        keyAlias = checkNotNull(androidKeyAlias)
        keyPassword = checkNotNull(androidKeyPassword)
      }
    }
  }

  defaultConfig {
    applicationId = "ai.openclaw.app"
    minSdk = 30
    targetSdk = 36
    versionCode = 2026060501
    versionName = "2026.6.5"
  }

  buildTypes {
    release {
      if (hasAndroidReleaseSigning) {
        signingConfig = signingConfigs.getByName("release")
      }
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
    debug {
      isMinifyEnabled = false
    }
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  packaging {
    resources {
      excludes +=
        setOf(
          "/META-INF/{AL2.0,LGPL2.1}",
          "/META-INF/*.version",
          "DebugProbesKt.bin",
          "kotlin-tooling-metadata.json",
        )
    }
  }

  lint {
    lintConfig = file("lint.xml")
    warningsAsErrors = true
  }
}

kotlin {
  compilerOptions {
    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    allWarningsAsErrors.set(true)
  }
}

ktlint {
  android.set(true)
  ignoreFailures.set(false)
  filter {
    exclude("**/build/**")
  }
}

dependencies {
  implementation(project(":audio"))
  implementation(project(":common"))

  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)

  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  implementation(libs.androidx.wear)
  implementation(libs.androidx.wear.compose.foundation)
  implementation(libs.androidx.wear.compose.material)

  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.kotlinx.coroutines.play.services)
  implementation(libs.kotlinx.serialization.json)

  implementation(libs.play.services.wearable)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.robolectric)
  testImplementation(libs.androidx.test.ext.junit)
}
