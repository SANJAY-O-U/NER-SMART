import 'package:flutter_test/flutter_test.dart';

import 'package:ner_smart_driver/main.dart';

void main() {
  testWidgets('Home screen shows Report Incident button', (WidgetTester tester) async {
    await tester.pumpWidget(const NerSmartApp());

    expect(find.text('REPORT INCIDENT'), findsOneWidget);
    expect(find.text('NER SMART'), findsOneWidget);
  });
}