# SafeWalk – Flutter Frontend

## Architecture Overview (MVVM)

The project follows the **MVVM (Model-View-ViewModel)** architecture pattern, which cleanly separates UI code from business logic and data access. All state management is handled via the [`provider`](https://pub.dev/packages/provider) package, using `ChangeNotifier`-based ViewModels.

### Layer diagram

```
┌─────────────────────────────────────────────────────┐
│                      Views                          │
│  (Screens / Widgets – pure UI, no business logic)   │
└────────────────────────┬────────────────────────────┘
                         │ observes (Provider / Consumer)
┌────────────────────────▼────────────────────────────┐
│                   ViewModels                        │
│  (State + business logic via ChangeNotifier)        │
└────────────────────────┬────────────────────────────┘
                         │ calls
┌────────────────────────▼────────────────────────────┐
│                    Services                         │
│  (Domain-specific API methods)                      │
└────────────────────────┬────────────────────────────┘
                         │ uses
┌────────────────────────▼────────────────────────────┐
│                  Core / Network                     │
│  (ApiClient – HTTP verbs, ApiResult, constants)     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                     Models                          │
│  (Data classes, e.g. User – used across all layers) │
└─────────────────────────────────────────────────────┘
```

### Folder structure

```
lib/
├── main.dart                          # App entry point – wires up Providers
├── app.dart                           # MaterialApp config, auth-based routing
│
├── core/                              # Shared infrastructure
│   ├── constants/
│   │   └── api_constants.dart         # Base URL, endpoint paths, timeouts
│   └── network/
│       ├── api_client.dart            # Generic HTTP client (GET/POST/PUT/DELETE)
│       └── api_result.dart            # Uniform result type for all API calls
│
├── models/                            # Data classes
│   └── user.dart                      # User model (JSON serialisable)
│
├── services/                          # Service layer (bridges VMs ↔ network)
│   └── api_service.dart               # Domain methods: testConnection, login, …
│
├── viewmodels/                        # State & logic (one per feature)
│   ├── home_viewmodel.dart            # API test logic
│   ├── login_viewmodel.dart           # Auth state, login / register actions
│   ├── map_viewmodel.dart             # (placeholder)
│   ├── contacts_viewmodel.dart        # (placeholder)
│   └── settings_viewmodel.dart        # (placeholder)
│
└── views/                             # UI screens (no business logic)
    ├── main_shell.dart                # Bottom navigation bar wrapper
    ├── home/
    │   └── home_screen.dart           # Backend connectivity test
    ├── login/
    │   └── login_screen.dart          # Login / Registration form
    ├── map/
    │   └── map_screen.dart            # Map placeholder
    ├── contacts/
    │   └── contacts_screen.dart       # Contacts placeholder
    └── settings/
        └── settings_screen.dart       # Settings placeholder
```

### How the layers interact

1. **`main.dart`** creates a shared `ApiService` and all `ChangeNotifierProvider`s, then launches `SafeWalkApp`.
2. **`app.dart`** (`SafeWalkApp`) listens to `LoginViewModel.isAuthenticated` and shows either the `LoginScreen` or the `MainShell` (bottom tab bar).
3. **Views** (e.g. `HomeScreen`) call `context.watch<HomeViewModel>()` to observe state and invoke actions like `vm.testApiConnection()`.
4. **ViewModels** contain all mutable state and call methods on `ApiService`.
5. **`ApiService`** translates domain calls into HTTP requests using `ApiClient` and returns `ApiResult` objects.
6. **Models** (e.g. `User`) are plain Dart classes with `fromJson` / `toJson` for serialisation.

### Adding a new feature

1. Create a **Model** in `lib/models/` if the feature needs new data classes.
2. Add endpoint constants to `lib/core/constants/api_constants.dart`.
3. Add domain methods in `lib/services/api_service.dart`.
4. Create a **ViewModel** in `lib/viewmodels/` extending `ChangeNotifier`.
5. Register the ViewModel in `main.dart`'s `MultiProvider`.
6. Create the **View** (screen) in `lib/views/<feature>/` and observe the ViewModel with `context.watch`.

---

## Run on iOS

### Create an iPhone Simulator Device

Make sure you have installed the correct iOS version (in this case 26.2). Change the following code according to your iOS version

```
xcrun simctl create "iPhone 16e 26.2" com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-26-2
```

### List available devices & run Simulator

```
xcrun simctl list devices
```

Select the ID from the device you want to emulate and run

```
open -a Simulator --args -CurrentDeviceUDID <your-device-id>
```

with your id instead of `<your-device-id>`.

When running `flutter devices` you should now see the emulator.

### Running the app on the device

Copy the Device id listed in `flutter devices` and run

```
flutter run -d <your-device-id> --dart-define-from-file=firebase.env.json
```

with your device id.

For hot-reload press `r` in the terminal.
