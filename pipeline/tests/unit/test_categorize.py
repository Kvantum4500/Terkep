import pytest

from terkep_pipeline.categorize import categorize_osm, categorize_wikidata


@pytest.mark.parametrize(
    "tags,area,expected",
    [
        (
            {"historic": "castle", "castle_type": "stately", "name": "Esterházy-kastély"},
            None,
            ("kastely", "kastély"),
        ),
        ({"historic": "castle", "name": "Ráday-kastély"}, None, ("kastely", None)),
        ({"historic": "castle", "ruins": "yes", "name": "Csesznek vára"}, None, ("var", "várrom")),
        (
            {"historic": "castle", "castle_type": "fortress", "name": "Komáromi Monostori erőd"},
            None,
            ("var", "erőd"),
        ),
        ({"historic": "castle", "name": "Egri vár"}, None, ("var", None)),
        ({"historic": "archaeological_site", "name": "Bákai földvár"}, None, ("rom", "földvár")),
        ({"historic": "ruins", "name": "Salgó vára"}, None, ("var", "várrom")),
        ({"historic": "ruins", "name": "Zsámbéki templomrom"}, None, ("rom", "templomrom")),
        (
            {"amenity": "place_of_worship", "religion": "jewish", "name": "Zsinagóga"},
            None,
            ("templom", "zsinagóga"),
        ),
        (
            {"amenity": "place_of_worship", "building": "chapel", "name": "Szent Anna-kápolna"},
            None,
            ("templom", "kápolna"),
        ),
        (
            {"amenity": "place_of_worship", "place_of_worship": "wayside_shrine", "name": "Kereszt"},
            None,
            None,
        ),
        ({"man_made": "bridge", "name": "Valami híd"}, None, None),
        ({"man_made": "bridge", "name": "Lánchíd", "wikidata": "Q1"}, None, ("hid", None)),
        ({"historic": "bridge", "name": "Kilenclyukú híd"}, None, ("hid", "történelmi híd")),
        ({"tourism": "viewpoint", "man_made": "tower", "name": "Erzsébet-kilátó"}, None, ("kilato", None)),
        ({"man_made": "tower", "tower:type": "observation", "name": "Kilátó"}, None, ("kilato", None)),
        ({"tourism": "viewpoint", "name": "Kilátópont"}, None, ("kilatopont", None)),
        ({"natural": "cave_entrance", "name": "Baradla-barlang"}, None, ("barlang", None)),
        ({"natural": "cliff", "name": "Bazaltorgonák"}, None, ("szikla", "bazaltorgona")),
        ({"natural": "peak", "name": "Kékes", "ele": "1014"}, None, ("csucs", None)),
        ({"natural": "water", "water": "lake", "name": "Kis tó"}, 0.05, None),
        ({"natural": "water", "water": "lake", "name": "Nagy tó"}, 1.2, ("to", None)),
        (
            {"natural": "water", "water": "reservoir", "name": "Tisza-tó", "wikidata": "Q2"},
            120.0,
            ("to", "víztározó"),
        ),
        ({"waterway": "waterfall", "name": "Fátyol-vízesés"}, None, ("vizeses", None)),
        ({"natural": "spring", "name": "Szalajka-forrás"}, None, ("forras", None)),
        (
            {"leisure": "garden", "garden:type": "botanical", "name": "Füvészkert"},
            None,
            ("kert", "botanikus kert"),
        ),
        ({"tourism": "attraction", "name": "Szoborpark"}, None, None),
        ({"tourism": "attraction", "name": "Szoborpark", "wikidata": "Q3"}, None, ("egyeb", None)),
        ({"historic": "castle"}, None, None),  # név nélkül nincs
    ],
)
def test_osm_rules(tags, area, expected):
    assert categorize_osm(tags, area) == expected


def test_wikidata_castle_split_by_name():
    class_to_root = {"Q23413": "Q23413", "Q879050": "Q879050"}
    assert categorize_wikidata(["Q23413"], class_to_root, "Egri vár") == "var"
    assert categorize_wikidata(["Q23413"], class_to_root, "Festetics-kastély") == "kastely"
    assert categorize_wikidata(["Q879050"], class_to_root, "Valami kúria") == "kastely"
    assert categorize_wikidata(["Q999"], class_to_root, "Valami") is None


def test_wikidata_priority_follows_config_order():
    # kastély (Q879050) előrébb van a sorban, mint a templom (Q16970)
    class_to_root = {"Q879050": "Q879050", "Q16970": "Q16970"}
    assert categorize_wikidata(["Q16970", "Q879050"], class_to_root, "X") == "kastely"
