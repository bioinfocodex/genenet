import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.activity.deleteMany({});
  await prisma.experiment.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.user.deleteMany({});

  const jane = await prisma.user.create({
    data: { name: 'Dr. Jane Smith', email: 'jane@benchling.com', role: 'PI', avatar: '👩‍🔬' }
  });
  
  const john = await prisma.user.create({
    data: { name: 'John Doe', email: 'john@benchling.com', role: 'PostDoc', avatar: '👨‍🔬' }
  });
  
  const alice = await prisma.user.create({
    data: { name: 'Alice Chen', email: 'alice@benchling.com', role: 'Grad Student', avatar: '🧬' }
  });

  await prisma.task.create({ data: { title: 'Order PCR primers for GAPDH', status: 'TODO', assignedToId: alice.id } });
  await prisma.task.create({ data: { title: 'Yeast Transformation', description: 'Transform pRS316-GAPDH into BY4741', status: 'TODO', assignedToId: john.id } });
  await prisma.task.create({ data: { title: 'Prepare competent cells', status: 'IN_PROGRESS', assignedToId: john.id } });
  await prisma.task.create({ data: { title: 'Gel Extraction of EcoRI/BamHI cut', status: 'DONE', assignedToId: jane.id } });

  const exp1 = await prisma.experiment.create({
    data: {
      title: 'Colony PCR Verification',
      protocol: 'PCR',
      status: 'COMPLETED',
      resultData: JSON.stringify({ notes: 'Band verified at ~1.2kb, confirming successful insertion.' }),
      expectedParams: JSON.stringify({ bandSizes: [1250, 400] }),
      userId: john.id
    }
  });

  const exp2 = await prisma.experiment.create({
    data: {
      title: 'Vector Backbone Prep',
      protocol: 'Restriction digestion',
      status: 'IN_PROGRESS',
      resultData: JSON.stringify({ notes: 'Cutting pUC19 with EcoRI and HindIII for 2 hours.' }),
      expectedParams: JSON.stringify({
         plasmidName: "pUC19",
         totalBp: 2686,
         cuts: [
           { enzyme: "EcoRI", position: 396 },
           { enzyme: "HindIII", position: 447 }
         ]
      }),
      userId: jane.id
    }
  });
  
  const exp3 = await prisma.experiment.create({
    data: {
      title: 'Plasmid Assembly',
      protocol: 'Plasmid construction',
      status: 'PLANNED',
      resultData: JSON.stringify({ notes: 'Assembling custom destination vector.' }),
      expectedParams: JSON.stringify({
         plasmidName: "pDEST-Custom",
         totalBp: 5400,
         cuts: [
           { enzyme: "BamHI", position: 1200 },
           { enzyme: "XhoI", position: 1540 },
           { enzyme: "NdeI", position: 3200 }
         ]
      }),
      userId: alice.id
    }
  });

  await prisma.activity.create({ data: { action: 'logged a new experiment', target: exp2.title, userId: jane.id } });
  await prisma.activity.create({ data: { action: 'completed a protocol', target: exp1.title, userId: john.id } });
  await prisma.activity.create({ data: { action: 'prepared competent cells', target: 'Lab Stock', userId: john.id } });

  console.log('Seeded database beautifully with expected result data!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
