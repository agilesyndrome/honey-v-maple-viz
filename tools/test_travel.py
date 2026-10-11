"""Offline regression checks for per-stop mode changes and transit estimates."""
import copy
import json
import math
import unittest

from build import DATA_FILE, build_hm, hav_km, stop_km, travel_time


class TravelTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(DATA_FILE.read_text())
        self.defaults = self.data['travelDefaults']
        self.stop = copy.deepcopy(next(s for s in self.data['stops'] if s['key'] == 'harbourfront'))
        self.stop['travel'].pop('transitMinutes', None)
        self.stop['travel'].pop('source', None)

    def test_transit_includes_access_wait_and_riding(self):
        # 0.5 km on foot (6 min), a 5 min wait, 3.9 km riding (15.6 min).
        self.assertEqual(travel_time(self.stop, self.defaults)['minutes'], 27)

    def test_mode_change_uses_its_own_estimate(self):
        self.stop['travel']['mode'] = 'walk'
        self.assertEqual(travel_time(self.stop, self.defaults)['minutes'], 50)
        self.stop['travel']['mode'] = 'transit'
        self.assertEqual(travel_time(self.stop, self.defaults)['minutes'], 27)

    def test_observed_transit_minutes_override_model(self):
        self.stop['travel']['transitMinutes'] = 32
        self.assertEqual(travel_time(self.stop, self.defaults)['minutes'], 32)

    def test_individual_wait_and_access_are_editable(self):
        self.stop['travel'].update(accessKm=1, waitMinutes=10, speedKph=20)
        self.assertEqual(travel_time(self.stop, self.defaults)['minutes'], 32)

    def test_access_is_bounded_by_route(self):
        self.stop['routeKm'] = 0.1
        self.assertEqual(travel_time(self.stop, self.defaults)['minutes'], 6)

    def test_initial_modes_follow_original_first_visible_ring(self):
        hm = build_hm(self.data)
        scope = 20
        visible = [r for r in hm['chart']['ringKm'] if r <= scope * 1.02 and r * hm['chart']['rMaxPx'] / scope >= 24]
        threshold = self.defaults['initialTorontoWalkingRadiusKm']
        self.assertEqual(threshold, min(visible))
        for stop in self.data['stops']:
            # This verifies the original defaults, before individually authored exceptions.
            if stop['key'] not in ('walmart', 'misc', 'andore', 'harbourfront', 'ikea',
                                   'foodlion', 'jubala', 'sola', 'bw', 'target', 'mandolin'):
                continue
            expected = 'drive' if stop['city'] == 'raleigh' else ('walk' if hav_km(self.data['cities']['toronto']['home'], stop) <= threshold else 'transit')
            self.assertEqual(stop['travel']['mode'], expected)

    def test_map_provider_estimates_are_used(self):
        stops = build_hm(self.data)['stops']
        for stop in stops:
            if stop['key'] in ('harbourfront', 'ikea'):
                self.assertEqual(stop['minutes'], 35)
                self.assertIn('Google Maps', stop['timeDetail'])

    def test_raleigh_estimates_are_preserved(self):
        stops = build_hm(self.data)['stops']
        self.assertEqual({s['key']: s['minutes'] for s in stops if s['key'] in ('foodlion', 'jubala', 'sola', 'bw', 'target', 'mandolin')},
                         {'foodlion': 4, 'jubala': 12, 'sola': 18, 'bw': 11, 'target': 8, 'mandolin': 26})

    def test_supplied_distances_and_walking_exceptions(self):
        stops = {s['key']: s for s in build_hm(self.data)['stops']}
        for key, distance, minutes in [('school-raleigh', .7, 10), ('school-toronto', 1.2, 15), ('metro', .7, 7)]:
            with self.subTest(key=key):
                self.assertEqual(stops[key]['km'], distance)
                self.assertEqual(stops[key]['minutes'], minutes)
                self.assertEqual(stops[key]['travelMode'], 'walk')
                self.assertIsNone(stops[key]['bearingText'])
                self.assertIsNone(stops[key]['routeStr'])

    def test_invalid_supplied_distance_is_rejected(self):
        for value in [0, -1, True, math.nan, math.inf, '0.7']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                stop_km({}, {'key':'supplied', 'distanceKm':value})

    def test_museum_modes_and_map_times(self):
        stops = {s['key']: s for s in build_hm(self.data)['stops']}
        for key, mode, minutes in [('rom', 'transit', 35), ('science-museum', 'drive', 30)]:
            self.assertEqual(stops[key]['category'], 'fun-games')
            self.assertEqual(stops[key]['travelMode'], mode)
            self.assertEqual(stops[key]['minutes'], minutes)
            self.assertIn('Google Maps', stops[key]['timeDetail'])

    def test_bad_travel_inputs_fail(self):
        for field, value in [('mode', 'fly'), ('speedKph', 0), ('waitMinutes', -1), ('accessKm', math.nan), ('transitMinutes', math.inf)]:
            with self.subTest(field=field):
                stop = copy.deepcopy(self.stop)
                stop['travel'][field] = value
                with self.assertRaises(ValueError):
                    travel_time(stop, self.defaults)


if __name__ == '__main__':
    unittest.main()
