// MainShell provides the bottom navigation bar that wraps the main
// screens (Home, Map, Contacts, Tipps, Settings) after the user has logged in.
//
// It uses an [IndexedStack] so that each tab preserves its state when the
// user switches between tabs.

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/models/map_models.dart';
import 'package:safewalk/viewmodels/contacts_viewmodel.dart';
import 'package:safewalk/viewmodels/map_viewmodel.dart';
import 'package:safewalk/views/home/home_screen.dart';
import 'package:safewalk/views/map/map_screen.dart';
import 'package:safewalk/views/contacts/contacts_screen.dart';
import 'package:safewalk/views/settings/settings_screen.dart';
import 'package:safewalk/views/tips/tips_screen.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  /// Index of the currently selected tab.
  int _currentIndex = 0;

  /// The top-level screens shown inside the bottom navigation.
  static const List<Widget> _screens = [
    HomeScreen(),
    MapScreen(),
    ContactsScreen(),
    TipsScreen(),
    SettingsScreen(),
  ];

  /// Labels and icons for each tab.
  List<BottomNavigationBarItem> get _navItems => [
    const BottomNavigationBarItem(
      icon: Icon(Icons.home_outlined),
      label: 'Home',
    ),
    const BottomNavigationBarItem(
      icon: Icon(Icons.map_outlined),
      label: 'Karte',
    ),
    const BottomNavigationBarItem(
      icon: Icon(Icons.contacts_outlined),
      label: 'Kontakte',
    ),
    BottomNavigationBarItem(
      icon: SvgPicture.asset(
        'assets/icons/tips_tab_icon.svg',
        width: 20,
        height: 20,
      ),
      label: 'Tipps',
    ),
    const BottomNavigationBarItem(
      icon: Icon(Icons.settings_outlined),
      label: 'Einstellungen',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<MapViewModel>();

    return Scaffold(
      // IndexedStack keeps all children alive so tab state is preserved.
      body: Stack(
        children: [
          IndexedStack(index: _currentIndex, children: _screens),
          if (vm.hasActiveSos)
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              left: 16,
              right: 16,
              child: _SosBannerOverlay(
                activeSosLocations: vm.activeSosLocations,
                onTap: () => setState(() => _currentIndex = 1),
              ),
            ),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) {
          setState(() => _currentIndex = index);
          // Refresh contacts data when switching to the Kontakte tab.
          if (index == 2) {
            context.read<ContactsViewModel>().fetchContacts();
          }
        },
        type: BottomNavigationBarType.fixed,
        items: _navItems,
      ),
    );
  }
}

class _SosBannerOverlay extends StatelessWidget {
  const _SosBannerOverlay({
    required this.activeSosLocations,
    required this.onTap,
  });

  final List<ActiveSosLocation> activeSosLocations;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final primary = activeSosLocations.first;
    final additional = activeSosLocations.length - 1;
    final age = primary.ageFrom();

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: onTap,
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.6, end: 1.0),
          duration: const Duration(milliseconds: 600),
          curve: Curves.easeInOut,
          builder: (context, value, child) {
            return Container(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              decoration: BoxDecoration(
                color: Color.lerp(
                  const Color(0xFFB91C1C),
                  const Color(0xFFEF4444),
                  value,
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x55EF4444),
                    blurRadius: 16,
                    offset: Offset(0, 6),
                  ),
                ],
              ),
              child: child,
            );
          },
          child: Row(
            children: [
              const Icon(
                Icons.priority_high_rounded,
                color: Colors.white,
                size: 28,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      additional > 0
                          ? 'SOS – ${primary.victimDisplayName} (+$additional weitere)'
                          : 'SOS – ${primary.victimDisplayName}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Letztes Update vor ${_formatAge(age)}',
                      style: const TextStyle(
                        color: Color(0xFFFEE2E2),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.map_rounded, color: Colors.white, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

String _formatAge(Duration age) {
  if (age.inMinutes >= 60) {
    final hours = age.inHours;
    return '$hours ${hours == 1 ? 'Stunde' : 'Stunden'}';
  }
  if (age.inMinutes >= 1) {
    return '${age.inMinutes} ${age.inMinutes == 1 ? 'Minute' : 'Minuten'}';
  }
  return '${age.inSeconds} ${age.inSeconds == 1 ? 'Sekunde' : 'Sekunden'}';
}
