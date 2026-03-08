// ContactsScreen displays the user's trusted (emergency) contacts.
//
// Design based on Figma SafeWalk page (nodes 2004:187 & 2172:367):
// - Header with +/- toggle to show/hide the sharing-code panel
// - Contact cards that expand on tap to reveal permission toggles
//   and a "Kontakt entfernen" action.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/models/contact.dart';
import 'package:safewalk/viewmodels/contacts_viewmodel.dart';

// ─── Design tokens (from Figma) ──────────────────────────────────────────────
const _kBackground = Color(0xFFF5F8F8);
const _kTealDark = Color(0xFF00666B);
const _kTealMid = Color(0xFF5E8A8D);
const _kTextDark = Color(0xFF101818);
const _kSlateText = Color(0xFF0F172A);
const _kCardShadow = Color(0x0D000000); // 5 % black
const _kToggleOnBg = Color(0xFF00666B);
const _kToggleOffBg = Color(0xFFE2E8F0);
const _kToggleOffBorder = Color(0xFFCBD5E1);
const _kInputBg = Color(0xFFF1F5F9);
const _kDivider = Color(0xFFF1F5F9);
const _kRed = Color(0xFFEF4444);
const _kInputHint = Color(0xFF6B7280);
const _kSosPurpleBg = Color(0x1A58355E); // rgba(88,53,94,0.10)

class ContactsScreen extends StatelessWidget {
  const ContactsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => ContactsViewModel(),
      child: const _ContactsView(),
    );
  }
}

// ─── Main View ───────────────────────────────────────────────────────────────

class _ContactsView extends StatelessWidget {
  const _ContactsView();

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<ContactsViewModel>();

    return Scaffold(
      backgroundColor: _kBackground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Header ─────────────────────────────────────────────
            _Header(
              isOpen: vm.isSharingPanelOpen,
              onToggle: vm.toggleSharingPanel,
            ),

            // ── Scrollable body ────────────────────────────────────
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                children: [
                  // Sharing-code panel (animated)
                  _SharingCodePanel(isVisible: vm.isSharingPanelOpen),

                  // Section label
                  const Padding(
                    padding: EdgeInsets.only(left: 4, top: 16, bottom: 12),
                    child: Text(
                      'KONTAKTE',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: _kTealMid,
                        letterSpacing: 0.6,
                      ),
                    ),
                  ),

                  // Contact cards
                  ...vm.contacts.map(
                    (c) => Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: _ContactCard(
                        contact: c,
                        isExpanded: vm.expandedContactId == c.id,
                        onTap: () => vm.toggleExpanded(c.id),
                        onToggleLocation: () => vm.toggleSharesLocation(c.id),
                        onToggleSOS: () => vm.toggleSharesSOS(c.id),
                        onDelete: () => vm.removeContact(c.id),
                        onApprove: () => vm.toggleApproved(c.id),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Header ──────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  const _Header({required this.isOpen, required this.onToggle});

  final bool isOpen;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text(
            'Bezugspersonen',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: _kTextDark,
              letterSpacing: -0.6,
            ),
          ),
          // +/- toggle button
          GestureDetector(
            onTap: onToggle,
            child: Container(
              width: 40,
              height: 40,
              decoration: const BoxDecoration(
                color: Color(0x1A00666B),
                shape: BoxShape.circle,
              ),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 200),
                transitionBuilder: (child, anim) =>
                    ScaleTransition(scale: anim, child: child),
                child: Icon(
                  isOpen ? Icons.remove : Icons.add,
                  key: ValueKey(isOpen),
                  size: 20,
                  color: _kTealDark,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Sharing Code Panel ──────────────────────────────────────────────────────

class _SharingCodePanel extends StatefulWidget {
  const _SharingCodePanel({required this.isVisible});

  final bool isVisible;

  @override
  State<_SharingCodePanel> createState() => _SharingCodePanelState();
}

class _SharingCodePanelState extends State<_SharingCodePanel> {
  final TextEditingController _codeInputController = TextEditingController();
  String? _errorText;
  bool _codeVisible = true;

  @override
  void initState() {
    super.initState();
    _codeInputController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _codeInputController.dispose();
    super.dispose();
  }

  bool get _canAddContact => _codeInputController.text.trim().length >= 6;

  void _copyCode(String code) {
    Clipboard.setData(ClipboardData(text: code));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Code kopiert!'),
        duration: Duration(seconds: 2),
      ),
    );
  }

  void _handleAddContact() {
    final code = _codeInputController.text.trim();
    if (code.length < 6) return;
    // TODO: validate and add contact via API
    setState(() => _errorText = null);
  }

  String _formatExpiry(DateTime dt) {
    final day = dt.day.toString().padLeft(2, '0');
    final month = dt.month.toString().padLeft(2, '0');
    final hour = dt.hour.toString().padLeft(2, '0');
    final minute = dt.minute.toString().padLeft(2, '0');
    return '$day.$month.${dt.year} um $hour:$minute Uhr';
  }

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<ContactsViewModel>();

    return AnimatedCrossFade(
      firstChild: const SizedBox.shrink(),
      secondChild: Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(17),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white),
          boxShadow: const [
            BoxShadow(
              color: _kCardShadow,
              blurRadius: 20,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── "Dein Sharing Code" section ──────────────────────
            Container(
              padding: const EdgeInsets.only(bottom: 16),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: _kDivider)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 16),
                  const Text(
                    'Dein Sharing Code',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: _kTextDark,
                    ),
                  ),
                  const SizedBox(height: 10),
                  // ── Active code state ─────────────────────────
                  if (vm.activeCode != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: _kInputBg,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _codeVisible
                                  ? vm.activeCode!
                                  : '•' * vm.activeCode!.length,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                color: _kTextDark,
                                letterSpacing: 4,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => _copyCode(vm.activeCode!),
                            icon: const Icon(Icons.copy_rounded, size: 20),
                            color: _kTealDark,
                            tooltip: 'Kopieren',
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                          ),
                          const SizedBox(width: 12),
                          IconButton(
                            onPressed: () =>
                                setState(() => _codeVisible = !_codeVisible),
                            icon: Icon(
                              _codeVisible
                                  ? Icons.visibility_rounded
                                  : Icons.visibility_off_rounded,
                              size: 20,
                            ),
                            color: _kTealDark,
                            tooltip: _codeVisible
                                ? 'Code verstecken'
                                : 'Code anzeigen',
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    // Expiry info
                    Row(
                      children: [
                        const Icon(
                          Icons.schedule_rounded,
                          size: 14,
                          color: _kTealMid,
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            'Gültig bis: ${_formatExpiry(vm.codeExpiresAt!)}',
                            style: const TextStyle(
                              fontSize: 12,
                              color: _kTealMid,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    // "Code erneuern" outlined button
                    SizedBox(
                      width: double.infinity,
                      height: 40,
                      child: OutlinedButton.icon(
                        onPressed: vm.generateCode,
                        icon: const Icon(Icons.refresh_rounded, size: 18),
                        label: const Text(
                          'Code erneuern',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: _kTealDark,
                          side: const BorderSide(color: _kTealDark),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                      ),
                    ),
                  ] else ...[
                    // ── No code yet ──────────────────────────────
                    SizedBox(
                      width: double.infinity,
                      height: 40,
                      child: ElevatedButton.icon(
                        onPressed: vm.generateCode,
                        icon: const Icon(Icons.visibility_rounded, size: 24),
                        label: const Text(
                          'Code generieren',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
                            letterSpacing: -0.6,
                          ),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _kTealDark,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                          elevation: 0,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  const Text(
                    'Teile diesen Code mit deinen Freunden, damit sie deinen '
                    'Standort oder im Notfall dein SOS Alarm empfangen können.',
                    style: TextStyle(
                      fontSize: 14,
                      color: _kTealMid,
                      height: 1.43,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),

            // ── "Code eingeben" section ──────────────────────────
            const SizedBox(height: 16),
            const Text(
              'Code eingeben',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: _kTextDark,
              ),
            ),
            const SizedBox(height: 10),
            Container(
              height: 50,
              decoration: BoxDecoration(
                color: _kInputBg,
                borderRadius: BorderRadius.circular(16),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  const Icon(
                    Icons.grid_view_rounded,
                    size: 24,
                    color: _kInputHint,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _codeInputController,
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        hintText: 'Hier den Code eingeben',
                        hintStyle: TextStyle(fontSize: 16, color: _kInputHint),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // Red error message between input and button
            if (_errorText != null) ...[
              const SizedBox(height: 4),
              Text(
                _errorText!,
                style: const TextStyle(fontSize: 12, color: _kRed),
              ),
            ],
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              height: 40,
              child: ElevatedButton(
                onPressed: _canAddContact ? _handleAddContact : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: _kTealDark,
                  disabledBackgroundColor: _kTealDark.withOpacity(0.4),
                  foregroundColor: Colors.white,
                  disabledForegroundColor: Colors.white.withOpacity(0.7),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  elevation: 0,
                ),
                child: const Text(
                  'Kontakt hinzufügen',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    letterSpacing: -0.6,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Gib hier den Code eines Freundes ein, um seinen/ihren '
              'Standort oder SOS Alarm zu erhalten.',
              style: TextStyle(fontSize: 14, color: _kTealMid, height: 1.43),
            ),
            const SizedBox(height: 10),

            Center(
              child: TextButton(
                onPressed: () {
                  // TODO: help action
                },
                child: const Text(
                  'Hilfe',
                  style: TextStyle(fontSize: 14, color: _kTealMid),
                ),
              ),
            ),
          ],
        ),
      ),
      crossFadeState: widget.isVisible
          ? CrossFadeState.showSecond
          : CrossFadeState.showFirst,
      duration: const Duration(milliseconds: 300),
      sizeCurve: Curves.easeInOut,
    );
  }
}

// ─── Contact Card ─────────────────────────────────────────────────────────────

class _ContactCard extends StatelessWidget {
  const _ContactCard({
    required this.contact,
    required this.isExpanded,
    required this.onTap,
    required this.onToggleLocation,
    required this.onToggleSOS,
    required this.onDelete,
    required this.onApprove,
  });

  final Contact contact;
  final bool isExpanded;
  final VoidCallback onTap;
  final VoidCallback onToggleLocation;
  final VoidCallback onToggleSOS;
  final VoidCallback onDelete;
  final VoidCallback onApprove;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeInOut,
          padding: const EdgeInsets.all(17),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.white),
            boxShadow: const [
              BoxShadow(
                color: _kCardShadow,
                blurRadius: 20,
                spreadRadius: -2,
                offset: Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // ── Top row (avatar + name + chevron) ────────────────
              Row(
                children: [
                  _Avatar(name: contact.name, avatarUrl: contact.avatarUrl),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                contact.name,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                  color: _kTextDark,
                                  height: 1.25,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          contact.permissionDescription,
                          style: const TextStyle(
                            fontSize: 14,
                            color: _kTealMid,
                            height: 1.43,
                          ),
                        ),
                      ],
                    ),
                  ),
                  AnimatedRotation(
                    turns: isExpanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 250),
                    child: const Icon(
                      Icons.keyboard_arrow_down_rounded,
                      color: _kTealMid,
                      size: 24,
                    ),
                  ),
                ],
              ),

              // ── Expanded content ──────────────────────────────
              AnimatedCrossFade(
                firstChild: const SizedBox.shrink(),
                secondChild: Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Column(
                    children: [
                      if (contact.isApproved) ...[
                        // Permission toggle rows
                        _ToggleRow(
                          icon: Icons.location_on_outlined,
                          iconBgColor: const Color(0x1A00666B),
                          label: 'Standort teilen',
                          value: contact.sharesLocation,
                          onChanged: onToggleLocation,
                          showTopBorder: true,
                        ),
                        _ToggleRow(
                          icon: Icons.emergency_outlined,
                          iconBgColor: _kSosPurpleBg,
                          label: 'Notfall SOS teilen',
                          value: contact.sharesSOS,
                          onChanged: onToggleSOS,
                          showTopBorder: false,
                        ),
                        // sharesBack info text
                      ] else ...[
                        // Not yet approved — show "Kontakt zum Teilen hinzufügen" button
                        const SizedBox(height: 6),
                        SizedBox(
                          width: double.infinity,
                          height: 40,
                          child: ElevatedButton.icon(
                            onPressed: onApprove,
                            icon: const Icon(
                              Icons.person_add_alt_1_rounded,
                              size: 20,
                            ),
                            label: const Text(
                              'Kontakt zum Teilen hinzufügen',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                                letterSpacing: -0.3,
                              ),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _kTealDark,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                              elevation: 0,
                            ),
                          ),
                        ),
                      ],
                      if (contact.sharesBackDescription != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Center(
                            child: Text(
                              contact.sharesBackDescription!,
                              style: const TextStyle(
                                fontSize: 14,
                                color: _kTealMid,
                                height: 1.43,
                              ),
                            ),
                          ),
                        ),
                      // "Kontakt entfernen" — always visible
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: GestureDetector(
                          onTap: onDelete,
                          child: const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.block, size: 16, color: _kRed),
                              SizedBox(width: 5),
                              Text(
                                'Kontakt entfernen',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w500,
                                  color: _kRed,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                crossFadeState: isExpanded
                    ? CrossFadeState.showSecond
                    : CrossFadeState.showFirst,
                duration: const Duration(milliseconds: 250),
                sizeCurve: Curves.easeInOut,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Toggle Row (Standort / SOS) ─────────────────────────────────────────────

class _ToggleRow extends StatelessWidget {
  const _ToggleRow({
    required this.icon,
    required this.iconBgColor,
    required this.label,
    required this.value,
    required this.onChanged,
    required this.showTopBorder,
  });

  final IconData icon;
  final Color iconBgColor;
  final String label;
  final bool value;
  final VoidCallback onChanged;
  final bool showTopBorder;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: showTopBorder
            ? const Border(top: BorderSide(color: _kDivider))
            : null,
      ),
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Row(
        children: [
          // Icon in tinted circle
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: iconBgColor,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(icon, size: 20, color: _kSlateText),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: _kSlateText,
              ),
            ),
          ),
          // Custom toggle matching Figma
          GestureDetector(
            onTap: onChanged,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width: 44,
              height: 24,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(9999),
                color: value ? _kToggleOnBg : _kToggleOffBg,
              ),
              child: AnimatedAlign(
                duration: const Duration(milliseconds: 200),
                alignment: value ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  width: 20,
                  height: 20,
                  margin: const EdgeInsets.all(2),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white,
                    border: value ? null : Border.all(color: _kToggleOffBorder),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name, this.avatarUrl});

  final String name;
  final String? avatarUrl;

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
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _kTealMid.withOpacity(0.15),
        border: Border.all(color: _kBackground, width: 2),
      ),
      child: avatarUrl != null
          ? ClipOval(
              child: Image.network(
                avatarUrl!,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) =>
                    _InitialsPlaceholder(initials: _initials),
              ),
            )
          : _InitialsPlaceholder(initials: _initials),
    );
  }
}

class _InitialsPlaceholder extends StatelessWidget {
  const _InitialsPlaceholder({required this.initials});

  final String initials;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        initials,
        style: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: _kTealDark,
        ),
      ),
    );
  }
}
