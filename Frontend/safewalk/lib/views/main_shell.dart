// MainShell provides the bottom navigation bar that wraps the main
// screens (Home, Map, Contacts, Tipps, Settings) after the user has logged in.
//
// It uses an [IndexedStack] so that each tab preserves its state when the
// user switches between tabs.

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/viewmodels/contacts_viewmodel.dart';
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
    return Scaffold(
      // IndexedStack keeps all children alive so tab state is preserved.
      body: IndexedStack(index: _currentIndex, children: _screens),
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
