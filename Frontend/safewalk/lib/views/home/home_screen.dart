import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/viewmodels/home_viewmodel.dart';

const Color _kPurpleText = Color(0xFF362B3E);
const Color _kTeal = Color(0xFF00666B);
const Color _kLightBg = Color(0xFFF5F8F8);
const Color _kRedBg = Color(0xFFD32F2F);
const Color _kDarkRedCta = Color(0xFFCC0000);

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<HomeViewModel>().initializeIfNeeded();
    });
  }

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<HomeViewModel>();

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 250),
      child: switch (vm.screenState) {
        SosScreenState.home => _HomeView(vm: vm),
        SosScreenState.countdown => _CountdownView(vm: vm),
        SosScreenState.active => _ActiveSosView(vm: vm),
      },
    );
  }
}

class _HomeView extends StatelessWidget {
  const _HomeView({required this.vm});

  final HomeViewModel vm;

  @override
  Widget build(BuildContext context) {
    final statusTitle = vm.isSharingLocation
        ? 'Standort wird geteilt'
        : 'Standort wird nicht geteilt';

    final footerText =
        vm.locationError ??
        (vm.isSharingLocation
            ? 'Dein Standort wird mit deinen Notfallkontakten geteilt'
            : 'Dein Standort wird aktuell nicht geteilt');

    return Container(
      key: const ValueKey('home-state'),
      color: _kLightBg,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            children: [
              const Text(
                'SafeWalk',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: _kPurpleText,
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Geringes\nGefahrenpotenzial',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: _kPurpleText,
                  fontSize: 30,
                  fontWeight: FontWeight.w700,
                  height: 1.2,
                ),
              ),
              const SizedBox(height: 8),
              InkWell(
                onTap: () => _showRiskInfo(context),
                borderRadius: BorderRadius.circular(14),
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Mehr erfahren',
                        style: TextStyle(
                          fontSize: 14,
                          color: Color(0x99362B3E),
                        ),
                      ),
                      SizedBox(width: 8),
                      Icon(
                        Icons.info_outline,
                        size: 16,
                        color: Color(0x99362B3E),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 18),
              _HomeSosButton(onTap: vm.startCountdown),
              const SizedBox(height: 18),
              const Text(
                'SOS Notfall',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w600,
                  color: _kPurpleText,
                ),
              ),
              const SizedBox(height: 16),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 18),
                child: Text(
                  'Drücke den SOS Knopf, um den Alarm auszulösen. Du kannst den Alarm innerhalb von 5 Sekunden abbrechen.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.42,
                    color: Color(0x99362B3E),
                  ),
                ),
              ),
              const Spacer(),
              _ShareStatusCard(
                title: statusTitle,
                subtitle: vm.bottomInfoText,
                liveEnabled: vm.isSharingLocation,
                isLoading: vm.isTogglingLocationSharing,
                onTap: vm.isTogglingLocationSharing
                    ? null
                    : () => _confirmToggleLocationSharing(context, vm),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 36,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Text(
                    footerText,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.42,
                      color: vm.locationError != null
                          ? const Color(0xFFB00020)
                          : const Color(0x99362B3E),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmToggleLocationSharing(
    BuildContext context,
    HomeViewModel vm,
  ) async {
    final enabling = !vm.isSharingLocation;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(
          enabling
              ? 'Standort teilen aktivieren?'
              : 'Standort teilen deaktivieren?',
        ),
        content: Text(
          enabling
              ? 'Dein Standort wird mit deinen Notfallkontakten geteilt.'
              : 'Dein Standort wird nicht mehr mit deinen Notfallkontakten geteilt.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Abbrechen'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(enabling ? 'Aktivieren' : 'Deaktivieren'),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;

    final success = enabling
        ? await vm.enableLocationSharing()
        : await vm.disableLocationSharing();

    if (!success && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            enabling
                ? 'Standortfreigabe konnte nicht aktiviert werden.'
                : 'Standortfreigabe konnte nicht deaktiviert werden.',
          ),
        ),
      );
    }
  }

  void _showRiskInfo(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Gefahrenpotenzial'),
        content: const Text(
          'Dieser Wert beschreibt die aktuelle Risikoeinschätzung deines Umfelds. '
          'Er kann sich durch Ort, Tageszeit und gemeldete Vorfälle ändern.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Schließen'),
          ),
        ],
      ),
    );
  }
}

class _CountdownView extends StatelessWidget {
  const _CountdownView({required this.vm});

  final HomeViewModel vm;

  @override
  Widget build(BuildContext context) {
    final seconds = vm.remainingSeconds.ceil().clamp(0, 5);

    return Container(
      key: const ValueKey('countdown-state'),
      color: _kRedBg,
      child: Stack(
        children: [
          const _UrgentBackgroundTint(),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
              child: Column(
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: _GpsStatusPill(isActive: vm.isGpsActive),
                  ),
                  const Spacer(),
                  const Text(
                    'Alarm wird\nausgelöst...',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      height: 1.25,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 28),
                  _CountdownCircle(
                    progress: vm.countdownProgress,
                    remainingLabel: '${seconds}s',
                  ),
                  const SizedBox(height: 24),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 20),
                    child: Text(
                      'Du kannst den Alarm innerhalb des Timers noch abbrechen.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.42,
                        color: Color(0xE6FFFFFF),
                      ),
                    ),
                  ),
                  const Spacer(),
                  _SwipeToConfirmSlider(
                    label: 'STREICHEN ZUM ABBRECHEN',
                    knobColor: Colors.white,
                    trackColor: const Color(0x1AFFFFFF),
                    textColor: const Color(0x99FFFFFF),
                    arrowColor: _kTeal,
                    onCompleted: vm.cancelCountdownAndReturnHome,
                  ),
                  const SizedBox(height: 16),
                  _CountdownSkipButton(
                    isLoading: vm.isSubmittingSos,
                    onPressed: vm.isSubmittingSos
                        ? null
                        : vm.skipCountdownTimer,
                  ),
                  const SizedBox(height: 16),
                  _LocationMeta(
                    text: vm.sosError ?? vm.bottomInfoText,
                    isError: vm.sosError != null || vm.locationError != null,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActiveSosView extends StatelessWidget {
  const _ActiveSosView({required this.vm});

  final HomeViewModel vm;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('active-state'),
      color: _kRedBg,
      child: Stack(
        children: [
          const _UrgentBackgroundTint(),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 33),
              child: Column(
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: _GpsStatusPill(isActive: vm.isGpsActive),
                  ),
                  const Spacer(),
                  const Text(
                    'Alarm ausgelöst!',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      height: 1.25,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 34),
                  const _ActiveSosCircle(),
                  const SizedBox(height: 31),
                  const Text(
                    'Notfallkontakte\nbenachrichtigt',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      height: 1.25,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 20),
                    child: Text(
                      'Deine Notfallkontakte haben eine Push-Benachrichtigung erhalten.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.42,
                        color: Color(0xE6FFFFFF),
                      ),
                    ),
                  ),
                  const Spacer(),
                  _SwipeToConfirmSlider(
                    label: 'STREICHEN ZUM ABBRECHEN',
                    knobColor: Colors.white,
                    trackColor: const Color(0x1AFFFFFF),
                    textColor: const Color(0x99FFFFFF),
                    arrowColor: _kTeal,
                    onCompleted: vm.cancelActiveSos,
                  ),
                  const SizedBox(height: 24),
                  _LocationMeta(
                    text: vm.sosError ?? vm.bottomInfoText,
                    isError: vm.sosError != null || vm.locationError != null,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _UrgentBackgroundTint extends StatelessWidget {
  const _UrgentBackgroundTint();

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              colors: [Color(0x33EDA4BD), Color(0x00EDA4BD)],
              radius: 0.75,
              center: Alignment(0, -0.1),
            ),
          ),
        ),
      ),
    );
  }
}

class _HomeSosButton extends StatelessWidget {
  const _HomeSosButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 224,
        height: 224,
        decoration: BoxDecoration(
          color: _kTeal,
          shape: BoxShape.circle,
          border: Border.all(color: const Color(0x4DBCFCEB), width: 8),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.wifi_tethering_rounded, color: Colors.white, size: 62),
            SizedBox(height: 6),
            Text(
              'SOS',
              style: TextStyle(
                color: Colors.white,
                fontSize: 36,
                height: 1.33,
                fontWeight: FontWeight.w700,
                letterSpacing: 2.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ShareStatusCard extends StatelessWidget {
  const _ShareStatusCard({
    required this.title,
    required this.subtitle,
    required this.liveEnabled,
    this.isLoading = false,
    this.onTap,
  });

  final String title;
  final String subtitle;
  final bool liveEnabled;
  final bool isLoading;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final cardBg = liveEnabled
        ? const Color(0x33BCFCEB)
        : const Color(0x1AA3A3A3);
    final cardBorder = liveEnabled
        ? const Color(0x80BCFCEB)
        : const Color(0x66999999);
    final headingColor = liveEnabled ? _kTeal : const Color(0xFF666666);
    final statusDot = liveEnabled
        ? const Color(0xFF22C55E)
        : const Color(0xFF9CA3AF);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 86),
        child: Ink(
          padding: const EdgeInsets.all(17),
          decoration: BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: cardBorder),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: const Color(0x1900666B),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Icon(
                  Icons.location_on_outlined,
                  color: liveEnabled ? _kTeal : const Color(0xFF666666),
                  size: 20,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: headingColor,
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: Color(0xB3362B3E),
                        fontSize: 12,
                        height: 1.33,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0x80FFFFFF),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: isLoading
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: _kTeal,
                        ),
                      )
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: statusDot,
                              borderRadius: BorderRadius.circular(999),
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            liveEnabled ? 'LIVE' : 'AUS',
                            style: const TextStyle(
                              color: _kPurpleText,
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ],
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GpsStatusPill extends StatelessWidget {
  const _GpsStatusPill({required this.isActive});

  final bool isActive;

  @override
  Widget build(BuildContext context) {
    final dotColor = isActive
        ? const Color(0xFFEF4444)
        : const Color(0xFFB8B8B8);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0x1AFFFFFF),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0x33FFFFFF)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: dotColor,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            isActive ? 'GPS AKTIV' : 'GPS INAKTIV',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}

class _CountdownCircle extends StatelessWidget {
  const _CountdownCircle({
    required this.progress,
    required this.remainingLabel,
  });

  final double progress;
  final String remainingLabel;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 220,
      height: 220,
      child: CustomPaint(
        painter: _CountdownOuterRingPainter(progress: progress),
        child: Center(
          child: Container(
            width: 192,
            height: 192,
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Color(0x40000000),
                  blurRadius: 18,
                  spreadRadius: -6,
                ),
              ],
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  remainingLabel,
                  style: const TextStyle(
                    color: _kRedBg,
                    fontSize: 52,
                    height: 1,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const Text(
                  'VERBLEIBEND',
                  style: TextStyle(
                    color: Color(0x99D32F2F),
                    fontSize: 14,
                    height: 1.42,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.7,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CountdownOuterRingPainter extends CustomPainter {
  _CountdownOuterRingPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width / 2) - 2.5;
    final rect = Rect.fromCircle(center: center, radius: radius);
    final remainingProgress = (1 - progress).clamp(0.0, 1.0);

    final basePaint = Paint()
      ..color = const Color(0xFFFF6C6C)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5;

    final progressPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, basePaint);
    if (remainingProgress > 0) {
      canvas.drawArc(
        rect,
        -math.pi / 2,
        math.pi * 2 * remainingProgress,
        false,
        progressPaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _CountdownOuterRingPainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}

class _ActiveSosCircle extends StatelessWidget {
  const _ActiveSosCircle();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 224,
      height: 224,
      decoration: const BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(color: Color(0x80EDA4BD), blurRadius: 50, spreadRadius: 0),
        ],
      ),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.wifi_tethering_rounded, color: _kTeal, size: 72),
          Text(
            'SOS\nAKTIV',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: _kTeal,
              fontSize: 30,
              height: 1.2,
              fontWeight: FontWeight.w800,
              letterSpacing: -1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _CountdownSkipButton extends StatelessWidget {
  const _CountdownSkipButton({
    required this.onPressed,
    required this.isLoading,
  });

  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 64,
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: _kDarkRedCta,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: const BorderSide(color: Colors.white),
          ),
        ),
        child: isLoading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.skip_next_rounded, size: 28),
                  SizedBox(width: 8),
                  Text(
                    'TIMER ÜBERSPRINGEN',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.45,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _LocationMeta extends StatelessWidget {
  const _LocationMeta({required this.text, required this.isError});

  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final color = isError ? const Color(0xFFFFE4E4) : const Color(0xB3FFFFFF);

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          isError ? Icons.error_outline : Icons.place_outlined,
          color: color,
          size: 12,
        ),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            text,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(color: color, fontSize: 12, height: 1.33),
          ),
        ),
      ],
    );
  }
}

class _SwipeToConfirmSlider extends StatefulWidget {
  const _SwipeToConfirmSlider({
    required this.label,
    required this.onCompleted,
    required this.knobColor,
    required this.trackColor,
    required this.textColor,
    required this.arrowColor,
  });

  final String label;
  final Future<void> Function() onCompleted;
  final Color knobColor;
  final Color trackColor;
  final Color textColor;
  final Color arrowColor;

  @override
  State<_SwipeToConfirmSlider> createState() => _SwipeToConfirmSliderState();
}

class _SwipeToConfirmSliderState extends State<_SwipeToConfirmSlider> {
  static const double _knobSize = 56;
  static const double _sidePadding = 4;

  double _dragX = 0;
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxX = (constraints.maxWidth - _knobSize - (_sidePadding * 2))
            .clamp(0.0, double.infinity)
            .toDouble();

        return Container(
          height: 64,
          decoration: BoxDecoration(
            color: widget.trackColor,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0x33FFFFFF)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x33000000),
                blurRadius: 15,
                spreadRadius: -4,
              ),
            ],
          ),
          child: Stack(
            alignment: Alignment.centerLeft,
            children: [
              Center(
                child: Text(
                  _submitting ? 'WIRD VERARBEITET...' : widget.label,
                  style: TextStyle(
                    color: widget.textColor,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.35,
                  ),
                ),
              ),
              Positioned(
                left: _sidePadding + _dragX,
                child: GestureDetector(
                  onHorizontalDragUpdate: _submitting
                      ? null
                      : (details) {
                          setState(() {
                            _dragX = (_dragX + details.delta.dx).clamp(
                              0.0,
                              maxX,
                            );
                          });
                        },
                  onHorizontalDragEnd: _submitting
                      ? null
                      : (_) async {
                          final completed = maxX > 0 && _dragX >= maxX * 0.88;
                          if (completed) {
                            setState(() => _submitting = true);
                            await widget.onCompleted();
                            if (!mounted) return;
                            setState(() {
                              _submitting = false;
                              _dragX = 0;
                            });
                          } else {
                            setState(() => _dragX = 0);
                          }
                        },
                  child: Container(
                    width: _knobSize,
                    height: _knobSize,
                    decoration: BoxDecoration(
                      color: widget.knobColor,
                      borderRadius: BorderRadius.circular(22),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x33000000),
                          blurRadius: 16,
                          spreadRadius: -4,
                        ),
                      ],
                    ),
                    child: Icon(
                      Icons.arrow_forward,
                      color: widget.arrowColor,
                      size: 24,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
