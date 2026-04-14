// LoginScreen provides a multi-step authentication form covering:
//   - Sign In
//   - Sign Up (with display name)
//   - Confirm Sign Up (verification code)
//   - Forgot Password
//   - Confirm Forgot Password (reset code + new password)
//
// The screen observes [LoginViewModel] to react to state changes
// (loading indicator, status messages, authentication result, current mode).

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/viewmodels/login_viewmodel.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _codeController = TextEditingController();
  final _newPasswordController = TextEditingController();

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _displayNameController.dispose();
    _codeController.dispose();
    _newPasswordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<LoginViewModel>();

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // App title
                const Text(
                  'SafeWalk',
                  style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  _subtitle(vm.authMode),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 32),

                // --- Dynamic form fields based on auth mode ---
                ..._buildFormFields(vm),

                const SizedBox(height: 24),

                // Submit button
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: vm.isLoading ? null : () => _submit(vm),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: vm.isLoading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            _submitLabel(vm.authMode),
                            style: const TextStyle(fontSize: 16),
                          ),
                  ),
                ),
                const SizedBox(height: 12),

                // --- Secondary actions ---
                ..._buildSecondaryActions(vm),

                // Status message
                if (vm.statusMessage.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(
                    vm.statusMessage,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: _isSuccessMessage(vm.statusMessage)
                          ? Colors.green
                          : Colors.red,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  String _subtitle(AuthMode mode) {
    switch (mode) {
      case AuthMode.signIn:
        return 'Willkommen zurück';
      case AuthMode.signUp:
        return 'Konto erstellen';
      case AuthMode.confirmSignUp:
        return 'E-Mail bestätigen';
      case AuthMode.forgotPassword:
        return 'Passwort vergessen';
      case AuthMode.confirmForgotPassword:
        return 'Neues Passwort setzen';
    }
  }

  String _submitLabel(AuthMode mode) {
    switch (mode) {
      case AuthMode.signIn:
        return 'Anmelden';
      case AuthMode.signUp:
        return 'Registrieren';
      case AuthMode.confirmSignUp:
        return 'Bestätigen';
      case AuthMode.forgotPassword:
        return 'Reset-Code senden';
      case AuthMode.confirmForgotPassword:
        return 'Passwort zurücksetzen';
    }
  }

  bool _isSuccessMessage(String msg) {
    final lower = msg.toLowerCase();
    return lower.contains('erfolgreich') ||
        lower.contains('bestätigt') ||
        lower.contains('successful');
  }

  List<Widget> _buildFormFields(LoginViewModel vm) {
    switch (vm.authMode) {
      case AuthMode.signIn:
        return [
          _emailField(),
          const SizedBox(height: 16),
          _passwordField(),
        ];

      case AuthMode.signUp:
        return [
          _displayNameField(),
          const SizedBox(height: 16),
          _emailField(),
          const SizedBox(height: 16),
          _passwordField(),
        ];

      case AuthMode.confirmSignUp:
        return [
          _emailField(initialValue: vm.pendingEmail),
          const SizedBox(height: 16),
          _codeField(label: 'Bestätigungscode'),
        ];

      case AuthMode.forgotPassword:
        return [
          _emailField(),
        ];

      case AuthMode.confirmForgotPassword:
        return [
          _emailField(initialValue: vm.pendingEmail),
          const SizedBox(height: 16),
          _codeField(label: 'Reset-Code'),
          const SizedBox(height: 16),
          _newPasswordField(),
        ];
    }
  }

  List<Widget> _buildSecondaryActions(LoginViewModel vm) {
    final widgets = <Widget>[];

    switch (vm.authMode) {
      case AuthMode.signIn:
        widgets.add(TextButton(
          onPressed:
              vm.isLoading ? null : () => vm.switchMode(AuthMode.signUp),
          child: const Text('Noch kein Konto? Registrieren'),
        ));
        widgets.add(TextButton(
          onPressed: vm.isLoading
              ? null
              : () => vm.switchMode(AuthMode.forgotPassword),
          child: const Text('Passwort vergessen?'),
        ));
        widgets.add(TextButton(
          onPressed: vm.isLoading ? null : () => vm.skipLogin(),
          child: const Text('Skip Login (Dev)'),
        ));
        break;

      case AuthMode.signUp:
        widgets.add(TextButton(
          onPressed:
              vm.isLoading ? null : () => vm.switchMode(AuthMode.signIn),
          child: const Text('Bereits ein Konto? Anmelden'),
        ));
        break;

      case AuthMode.confirmSignUp:
        widgets.add(TextButton(
          onPressed:
              vm.isLoading ? null : () => vm.switchMode(AuthMode.signIn),
          child: const Text('Zurück zum Login'),
        ));
        break;

      case AuthMode.forgotPassword:
        widgets.add(TextButton(
          onPressed:
              vm.isLoading ? null : () => vm.switchMode(AuthMode.signIn),
          child: const Text('Zurück zum Login'),
        ));
        break;

      case AuthMode.confirmForgotPassword:
        widgets.add(TextButton(
          onPressed:
              vm.isLoading ? null : () => vm.switchMode(AuthMode.signIn),
          child: const Text('Zurück zum Login'),
        ));
        break;
    }

    return widgets;
  }

  // ---------------------------------------------------------------------------
  // Form field widgets
  // ---------------------------------------------------------------------------

  Widget _emailField({String? initialValue}) {
    if (initialValue != null &&
        initialValue.isNotEmpty &&
        _emailController.text.isEmpty) {
      _emailController.text = initialValue;
    }
    return TextField(
      controller: _emailController,
      keyboardType: TextInputType.emailAddress,
      decoration: const InputDecoration(
        labelText: 'E-Mail',
        border: OutlineInputBorder(),
        prefixIcon: Icon(Icons.email),
      ),
    );
  }

  Widget _passwordField() {
    return TextField(
      controller: _passwordController,
      obscureText: true,
      decoration: const InputDecoration(
        labelText: 'Passwort',
        border: OutlineInputBorder(),
        prefixIcon: Icon(Icons.lock),
      ),
    );
  }

  Widget _displayNameField() {
    return TextField(
      controller: _displayNameController,
      decoration: const InputDecoration(
        labelText: 'Anzeigename',
        border: OutlineInputBorder(),
        prefixIcon: Icon(Icons.person),
      ),
    );
  }

  Widget _codeField({required String label}) {
    return TextField(
      controller: _codeController,
      keyboardType: TextInputType.number,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        prefixIcon: const Icon(Icons.pin),
      ),
    );
  }

  Widget _newPasswordField() {
    return TextField(
      controller: _newPasswordController,
      obscureText: true,
      decoration: const InputDecoration(
        labelText: 'Neues Passwort',
        border: OutlineInputBorder(),
        prefixIcon: Icon(Icons.lock_reset),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  void _submit(LoginViewModel vm) {
    switch (vm.authMode) {
      case AuthMode.signIn:
        vm.signIn(
          _emailController.text.trim(),
          _passwordController.text,
        );
        break;

      case AuthMode.signUp:
        final displayName = _displayNameController.text.trim();
        if (displayName.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Bitte gib einen Anzeigenamen ein.'),
              duration: Duration(seconds: 3),
            ),
          );
          return;
        }
        vm.signUp(
          _emailController.text.trim(),
          _passwordController.text,
          displayName: displayName,
        );
        break;

      case AuthMode.confirmSignUp:
        vm.confirmSignUp(
          _emailController.text.trim(),
          _codeController.text.trim(),
        );
        break;

      case AuthMode.forgotPassword:
        vm.forgotPassword(_emailController.text.trim());
        break;

      case AuthMode.confirmForgotPassword:
        vm.confirmForgotPassword(
          _emailController.text.trim(),
          _codeController.text.trim(),
          _newPasswordController.text,
        );
        break;
    }
  }
}
