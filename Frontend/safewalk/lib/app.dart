// SafeWalkApp is the root widget of the application.
//
// It configures the global [MaterialApp] theme and decides which screen to
// show based on the authentication state exposed by [LoginViewModel]:
//   - Initialising        → loading spinner (session restore in progress)
//   - Not authenticated   → [LoginScreen]
//   - Authenticated       → [MainShell] (bottom navigation with all tabs)
//
// All ViewModels are provided at this level via [MultiProvider] so that
// every screen in the widget tree can access them.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/viewmodels/login_viewmodel.dart';
import 'package:safewalk/views/login/login_screen.dart';
import 'package:safewalk/views/main_shell.dart';

class SafeWalkApp extends StatefulWidget {
  const SafeWalkApp({super.key});

  @override
  State<SafeWalkApp> createState() => _SafeWalkAppState();
}

class _SafeWalkAppState extends State<SafeWalkApp> {
  bool _initialising = true;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final loginVm = context.read<LoginViewModel>();
    await loginVm.tryRestoreSession();
    if (mounted) {
      setState(() => _initialising = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SafeWalk',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: _initialising
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : Consumer<LoginViewModel>(
              builder: (context, loginVm, _) {
                if (loginVm.isAuthenticated) {
                  return const MainShell();
                }
                return const LoginScreen();
              },
            ),
    );
  }
}
