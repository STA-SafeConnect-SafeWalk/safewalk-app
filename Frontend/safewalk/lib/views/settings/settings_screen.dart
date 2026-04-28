// SettingsScreen lets users view their profile, update their display name,
// sign out, and permanently delete their account.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/viewmodels/login_viewmodel.dart';
import 'package:safewalk/viewmodels/settings_viewmodel.dart';

// ─── Design tokens (shared with Contacts screen) ─────────────────────────────
const _kBackground = Color(0xFFF5F8F8);
const _kTealDark = Color(0xFF00666B);
const _kTealMid = Color(0xFF5E8A8D);
const _kTextDark = Color(0xFF101818);
const _kCardShadow = Color(0x0D000000);
const _kDivider = Color(0xFFF1F5F9);
const _kInputBg = Color(0xFFF1F5F9);
const _kRed = Color(0xFFEF4444);

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<SettingsViewModel>().loadProfile();
    });
  }

  @override
  Widget build(BuildContext context) {
    return const _SettingsView();
  }
}

// ─── Main view ────────────────────────────────────────────────────────────────

class _SettingsView extends StatelessWidget {
  const _SettingsView();

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<SettingsViewModel>();

    // React to account deletion → trigger sign-out and navigate to login.
    _handleAccountDeleted(context, vm);

    // Show snack-bars for errors and successes.
    _showMessages(context, vm);

    return Scaffold(
      backgroundColor: _kBackground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Page title ────────────────────────────────────────────
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(
                'Einstellungen',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: _kTextDark,
                  letterSpacing: -0.6,
                ),
              ),
            ),

            // ── Scrollable body ───────────────────────────────────────
            Expanded(
              child: vm.isLoading
                  ? const Center(
                      child: CircularProgressIndicator(color: _kTealDark),
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
                      children: [
                        // ── Profile card ──────────────────────────────
                        _ProfileCard(
                          displayName: vm.displayName,
                          email: vm.email,
                        ),

                        const SizedBox(height: 20),

                        // ── Edit display name ─────────────────────────
                        _EditDisplayNameCard(
                          currentName: vm.displayName,
                          isSaving: vm.isSaving,
                          onSave: (name) => vm.updateDisplayName(name),
                        ),

                        const SizedBox(height: 20),

                        // ── Account actions ───────────────────────────
                        _AccountActionsCard(
                          onSignOut: () => _confirmSignOut(context),
                          onDeleteAccount: () => _confirmDeleteAccount(context, vm),
                          isDeleting: vm.isDeleting,
                        ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  void _handleAccountDeleted(BuildContext context, SettingsViewModel vm) {
    if (!vm.isAccountDeleted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (context.mounted) {
        context.read<LoginViewModel>().signOut();
      }
    });
  }

  void _showMessages(BuildContext context, SettingsViewModel vm) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!context.mounted) return;
      if (vm.errorMessage != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(vm.errorMessage!),
            backgroundColor: _kRed,
            duration: const Duration(seconds: 4),
          ),
        );
        vm.clearError();
      }
      if (vm.successMessage != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(vm.successMessage!),
            backgroundColor: _kTealDark,
            duration: const Duration(seconds: 3),
          ),
        );
        vm.clearSuccess();
      }
    });
  }

  void _confirmSignOut(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Abmelden'),
        content: const Text('Möchtest du dich wirklich abmelden?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Abbrechen'),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<LoginViewModel>().signOut();
            },
            child: const Text('Abmelden', style: TextStyle(color: _kRed)),
          ),
        ],
      ),
    );
  }

  void _confirmDeleteAccount(BuildContext context, SettingsViewModel vm) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Konto löschen'),
        content: const Text(
          'Dein Konto wird dauerhaft gelöscht. Alle deine Daten, '
          'Bezugspersonen und Einstellungen werden unwiderruflich entfernt.\n\n'
          'Bist du sicher?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Abbrechen'),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              vm.deleteAccount();
            },
            child: const Text(
              'Konto löschen',
              style: TextStyle(color: _kRed, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Profile Card ─────────────────────────────────────────────────────────────

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.displayName, required this.email});

  final String? displayName;
  final String? email;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(color: _kCardShadow, blurRadius: 20, offset: Offset(0, 4)),
        ],
      ),
      child: Row(
        children: [
          _Avatar(name: displayName ?? 'U'),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  displayName ?? 'Unbekannte Person',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: _kTextDark,
                    height: 1.25,
                  ),
                ),
                if (email != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    email!,
                    style: const TextStyle(fontSize: 14, color: _kTealMid),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Edit Display Name Card ───────────────────────────────────────────────────

class _EditDisplayNameCard extends StatefulWidget {
  const _EditDisplayNameCard({
    required this.currentName,
    required this.isSaving,
    required this.onSave,
  });

  final String? currentName;
  final bool isSaving;
  final void Function(String name) onSave;

  @override
  State<_EditDisplayNameCard> createState() => _EditDisplayNameCardState();
}

class _EditDisplayNameCardState extends State<_EditDisplayNameCard> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.currentName ?? '');
  }

  @override
  void didUpdateWidget(_EditDisplayNameCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Pre-fill once the profile loads (currentName changes from null → value).
    if (oldWidget.currentName == null && widget.currentName != null) {
      _controller.text = widget.currentName!;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(color: _kCardShadow, blurRadius: 20, offset: Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Anzeigename',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: _kTextDark,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Dieser Name wird deinen Bezugspersonen angezeigt.',
            style: TextStyle(fontSize: 13, color: _kTealMid),
          ),
          const SizedBox(height: 12),
          Container(
            height: 50,
            decoration: BoxDecoration(
              color: _kInputBg,
              borderRadius: BorderRadius.circular(16),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Icon(Icons.person_outline, size: 20, color: _kTealMid),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      hintText: 'Dein Name',
                      hintStyle: TextStyle(fontSize: 16, color: _kTealMid),
                    ),
                    style: const TextStyle(
                      fontSize: 16,
                      color: _kTextDark,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: ElevatedButton(
              onPressed: widget.isSaving
                  ? null
                  : () => widget.onSave(_controller.text),
              style: ElevatedButton.styleFrom(
                backgroundColor: _kTealDark,
                disabledBackgroundColor: _kTealDark.withValues(alpha: 0.4),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                elevation: 0,
              ),
              child: widget.isSaving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text(
                      'Speichern',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.3,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Account Actions Card ─────────────────────────────────────────────────────

class _AccountActionsCard extends StatelessWidget {
  const _AccountActionsCard({
    required this.onSignOut,
    required this.onDeleteAccount,
    required this.isDeleting,
  });

  final VoidCallback onSignOut;
  final VoidCallback onDeleteAccount;
  final bool isDeleting;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(color: _kCardShadow, blurRadius: 20, offset: Offset(0, 4)),
        ],
      ),
      child: Column(
        children: [
          // Sign out row
          _ActionRow(
            icon: Icons.logout_rounded,
            label: 'Abmelden',
            iconColor: _kTealDark,
            iconBg: const Color(0x1A00666B),
            onTap: onSignOut,
            showDivider: true,
          ),
          // Delete account row
          _ActionRow(
            icon: Icons.delete_outline_rounded,
            label: isDeleting ? 'Wird gelöscht…' : 'Konto löschen',
            iconColor: _kRed,
            iconBg: const Color(0x1AEF4444),
            labelColor: _kRed,
            trailing: isDeleting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: _kRed,
                    ),
                  )
                : null,
            onTap: isDeleting ? null : onDeleteAccount,
            showDivider: false,
          ),
        ],
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.icon,
    required this.label,
    required this.iconColor,
    required this.iconBg,
    required this.onTap,
    required this.showDivider,
    this.labelColor = _kTextDark,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final Color iconColor;
  final Color iconBg;
  final Color labelColor;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(24),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: iconBg,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(icon, size: 20, color: iconColor),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      color: labelColor,
                    ),
                  ),
                ),
                trailing ??
                    Icon(
                      Icons.chevron_right_rounded,
                      color: _kTealMid.withValues(alpha: 0.6),
                      size: 20,
                    ),
              ],
            ),
          ),
        ),
        if (showDivider)
          const Divider(height: 1, thickness: 1, color: _kDivider, indent: 20, endIndent: 20),
      ],
    );
  }
}

// ─── Avatar (same design as on the Contacts screen) ──────────────────────────

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name});

  final String name;

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length >= 2) {
      return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
    }
    return name.isNotEmpty ? name[0].toUpperCase() : '?';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 72,
      height: 72,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _kTealMid.withValues(alpha: 0.15),
        border: Border.all(color: _kBackground, width: 2),
      ),
      child: Center(
        child: Text(
          _initials,
          style: const TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w600,
            color: _kTealDark,
          ),
        ),
      ),
    );
  }
}
