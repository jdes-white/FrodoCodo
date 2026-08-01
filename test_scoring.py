"""Sanity check: scoring.py against today's four screenshotted races.
Run directly: python test_scoring.py
"""
from scoring import score_race

races = {
    "Rosehill R3 (Columbus)":        [2.00, 8.00, 8.50, 9.50],
    "Rosehill R6 (Enviable)":        [2.35, 4.20, 5.00, 6.50],
    "Flemington R1 (Our Chief)":     [2.50, 2.80, 5.50, 8.00],
    "Flemington R8 (Sass Appeal)":   [1.75, 3.70, 7.00, 9.50],
}

print(f"{'Race':<28}{'Neds':>8}{'TABtouch':>10}{'Stack':>8}")
for name, odds in races.items():
    scores = score_race(odds)
    print(f"{name:<28}{scores['neds']:>8}{scores['tabtouch']:>9}%{scores['stack']:>8}")
