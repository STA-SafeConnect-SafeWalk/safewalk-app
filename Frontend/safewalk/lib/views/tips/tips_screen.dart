import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/models/tip.dart';
import 'package:safewalk/services/headphone_service.dart';
import 'package:safewalk/viewmodels/tips_viewmodel.dart';
import 'package:url_launcher/url_launcher.dart';

const _kBackground = Color(0xFFF5F8F8);
const _kPrimary = Color(0xFF00666B);
const _kSurface = Colors.white;
const _kText = Color(0xFF142226);
const _kMutedText = Color(0xFF5E7B80);
const _kSearchBackground = Color(0xFFF1F5F9);

class TipsScreen extends StatefulWidget {
  const TipsScreen({super.key});

  @override
  State<TipsScreen> createState() => _TipsScreenState();
}

class _TipsScreenState extends State<TipsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<TipsViewModel>().loadTips();
    });
  }

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<TipsViewModel>();

    _showError(context, vm);

    return Scaffold(
      backgroundColor: _kBackground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 20, 20, 8),
              child: Text(
                'Tipps',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  color: _kText,
                ),
              ),
            ),
            if (kDebugMode) _DebugHeadphoneToggle(vm: vm),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'Sicherheitstipps für deinen Alltag',
                style: TextStyle(fontSize: 14, color: _kMutedText),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: TextField(
                onChanged: vm.setSearchQuery,
                decoration: InputDecoration(
                  hintText: 'Tipps durchsuchen',
                  prefixIcon: const Icon(Icons.search),
                  fillColor: _kSearchBackground,
                  filled: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            SizedBox(
              height: 44,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 20),
                itemBuilder: (context, index) {
                  final category = vm.categories[index];
                  final isSelected = vm.selectedCategory == category;
                  return ChoiceChip(
                    label: Text(category),
                    selected: isSelected,
                    onSelected: (_) => vm.setSelectedCategory(category),
                    selectedColor: _kPrimary.withValues(alpha: 0.15),
                    labelStyle: TextStyle(
                      color: isSelected ? _kPrimary : _kMutedText,
                      fontWeight: FontWeight.w600,
                    ),
                    side: BorderSide(
                      color: isSelected ? _kPrimary : Colors.transparent,
                    ),
                  );
                },
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemCount: vm.categories.length,
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                color: _kPrimary,
                onRefresh: vm.loadTips,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                  children: [
                    if (vm.headphonesConnected)
                      _HeadphoneBanner(tip: TipsViewModel.headphoneTip),
                    if (vm.headphonesConnected) const SizedBox(height: 14),
                    if (vm.tipOfTheDay != null && vm.showTipOfDayHighlighted)
                      _TipOfDayCard(tip: vm.tipOfTheDay!),
                    if (vm.tipOfTheDay != null && vm.showTipOfDayHighlighted)
                      const SizedBox(height: 14),
                    if (vm.isLoading)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: CircularProgressIndicator(color: _kPrimary),
                        ),
                      )
                    else if (vm.filteredTips.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: Text(
                            'Keine Tipps für die aktuelle Auswahl gefunden.',
                            style: TextStyle(color: _kMutedText),
                          ),
                        ),
                      )
                    else
                      ...vm.filteredTips.map(
                        (tip) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _TipCard(tip: tip),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showError(BuildContext context, TipsViewModel vm) {
    if (vm.errorMessage == null) return;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!context.mounted || vm.errorMessage == null) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(vm.errorMessage!)));
      vm.clearError();
    });
  }
}

class _TipOfDayCard extends StatelessWidget {
  const _TipOfDayCard({required this.tip});

  final Tip tip;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: const LinearGradient(
          colors: [Color(0xFF0B6B70), Color(0xFF14858B)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2200666B),
            blurRadius: 14,
            offset: Offset(0, 6),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Tipp des Tages',
            style: TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _TipIcon(iconName: tip.icon, emphasized: true),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tip.title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      tip.description,
                      style: const TextStyle(color: Colors.white),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TipCard extends StatelessWidget {
  const _TipCard({required this.tip});

  final Tip tip;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: _kSurface,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _TipIcon(iconName: tip.icon),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tip.category,
                      style: const TextStyle(
                        color: _kMutedText,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      tip.title,
                      style: const TextStyle(
                        color: _kText,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            tip.description,
            style: const TextStyle(color: _kText, height: 1.35),
          ),
          if (tip.link != null && tip.link!.isNotEmpty) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () => _openReference(context, tip.link!),
              icon: const Icon(Icons.open_in_new, size: 18),
              label: const Text('Mehr erfahren'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _kPrimary,
                side: const BorderSide(color: _kPrimary),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _openReference(BuildContext context, String rawUrl) async {
    final uri = Uri.tryParse(rawUrl.trim());
    if (uri == null || !uri.hasScheme) {
      _showLinkError(context);
      return;
    }

    final wasOpened = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    );

    if (!wasOpened && context.mounted) {
      _showLinkError(context);
    }
  }

  void _showLinkError(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Der Link konnte nicht geöffnet werden.')),
    );
  }
}

class _TipIcon extends StatelessWidget {
  const _TipIcon({required this.iconName, this.emphasized = false});

  final String iconName;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final icon = _resolveIcon(iconName);
    final fg = emphasized ? const Color(0xFF00666B) : _kPrimary;

    return Container(
      width: 34,
      height: 34,
      decoration: BoxDecoration(
        color: emphasized ? Colors.white : const Color(0x1500666B),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Center(child: Icon(icon, color: fg, size: 20)),
    );
  }

  IconData _resolveIcon(String value) {
    switch (value.toLowerCase()) {
      case 'shield':
      case 'shield_outlined':
        return Icons.shield_outlined;
      case 'location':
      case 'location_on':
        return Icons.location_on_outlined;
      case 'call':
      case 'phone':
        return Icons.phone_in_talk_outlined;
      case 'visibility':
      case 'eye':
        return Icons.visibility_outlined;
      case 'directions':
      case 'map':
        return Icons.map_outlined;
      default:
        return Icons.tips_and_updates_outlined;
    }
  }
}

class _DebugHeadphoneToggle extends StatelessWidget {
  const _DebugHeadphoneToggle({required this.vm});

  final TipsViewModel vm;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
      child: Row(
        children: [
          const Icon(Icons.bug_report, size: 14, color: _kMutedText),
          const SizedBox(width: 6),
          const Text(
            'Debug:',
            style: TextStyle(fontSize: 12, color: _kMutedText),
          ),
          const SizedBox(width: 8),
          Switch(
            value: vm.headphonesConnected,
            activeColor: _kPrimary,
            onChanged: (value) {
              context.read<HeadphoneService>().debugSetConnected(value);
            },
          ),
          const Text(
            'Kopfhörer simulieren',
            style: TextStyle(fontSize: 12, color: _kMutedText),
          ),
        ],
      ),
    );
  }
}

class _HeadphoneBanner extends StatelessWidget {  const _HeadphoneBanner({required this.tip});

  final Tip tip;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: const LinearGradient(
          colors: [Color(0xFFE65100), Color(0xFFF57C00)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33E65100),
            blurRadius: 14,
            offset: Offset(0, 6),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.headphones, color: Colors.white, size: 16),
              const SizedBox(width: 6),
              const Text(
                'Achtung',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Center(
                  child: Icon(
                    Icons.visibility_outlined,
                    color: Color(0xFFE65100),
                    size: 20,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tip.title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      tip.description,
                      style: const TextStyle(color: Colors.white),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
